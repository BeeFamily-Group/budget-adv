Routine oraria della dashboard budget ADV BeeFamily: applica su Meta le modifiche al budget giornaliero chieste da Francesco.
Si cambia SOLO il budget giornaliero delle entità indicate dallo script. Mai stato, targeting, nomi, creatività, mai creare o cancellare.

Cartella: "$HOME/Desktop/CLAUDE CODE/BEEFAMILY/DASHBOARD BUDGET/budget-adv" (sempre tra virgolette).
Campi di servizio da aggiungere a OGNI chiamata Meta: client_conversation_id (20 caratteri alfanumerici, lo stesso per tutta la run),
client_model, advertiser_job "update_existing_campaigns", scheduled_task_run true.

1. Esegui: cd "$HOME/Desktop/CLAUDE CODE/BEEFAMILY/DASHBOARD BUDGET/budget-adv" && python3 -I tools/hourly.py pending
   Se "richieste" è 0, chiudi con "nessuna richiesta" e basta.

2. Leggi raw_hourly/plan.json e per ogni elemento di "calls" chiama `ads_get_ad_entities` con ESATTAMENTE i suoi "args"
   (più i campi di servizio, reporting_purpose ["entity_lookup"], include_additional_context false).

3. Esegui: cd "$HOME/Desktop/CLAUDE CODE/BEEFAMILY/DASHBOARD BUDGET/budget-adv" && python3 -I tools/hourly.py changes
   Per ogni richiesta stampata:
   a. Se "lettura_fallita" non è vuoto o "changes" è vuoto: registra l'errore e passa alla successiva:
      python3 -I tools/routine_api.py post requestResult '{"id":"<request_id>","status":"error","result":"<motivo breve>"}'
   b. Per ogni elemento di "changes", nell'ordine:
      - `ads_update_entity` con ad_account_id, entity_id, entity_type, fields = {"daily_budget": <new × 100>} (intero, centesimi), hide_ui true.
      - Se la risposta ha is_draft true: `ads_activate_entity` con ad_account_id, entity_id, entity_type,
        object_ids [entity_id] e publish_as_active false (pubblica solo la modifica, non cambia lo stato).
   c. Rileggi le entità toccate: `ads_get_ad_entities` con ad_account_id, level "campaign" o "adset" (come entity_type),
      object_ids [gli entity_id], fields ["id","effective_status","daily_budget"], reporting_purpose ["entity_lookup"].
      Costruisci il JSON {"<entity_id>": {"status": "<effective_status>", "daily_budget": <euro come numero>}} e esegui:
      python3 -I tools/apply_plan.py after --changes '<changes della richiesta>' --readback '<JSON>'
   d. Per ogni id in "reactivate": `ads_activate_entity` con ad_account_id, entity_id, entity_type (era attiva prima, Meta l'ha messa in pausa).
   e. Registra l'esito con il "message" dello script:
      python3 -I tools/routine_api.py post requestResult '{"id":"<request_id>","status":"applied" oppure "error","result":"<message>"}'

4. Chiudi con UNA riga per richiesta: canale, budget prima → dopo, esito.
