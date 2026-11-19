Routine notturna della dashboard budget ADV BeeFamily, Rhythm (https://rhythm.consulenzaperhotel.it/).
Solo lettura su Meta: non usare ads_update_entity, ads_activate_entity né altri strumenti che modificano.

Cartella di lavoro: "~/Desktop/CLAUDE CODE/BEEFAMILY/DASHBOARD BUDGET/budget-adv" (usa sempre il percorso tra virgolette).

1. Esegui: cd "$HOME/Desktop/CLAUDE CODE/BEEFAMILY/DASHBOARD BUDGET/budget-adv" && bash tools/run_nightly.sh plan
   Poi leggi raw/plan.json (in quella cartella): contiene "calls", ognuna con "key" e "args", e "windsor_calls".

2. Per OGNI elemento di "calls", in ordine, chiama lo strumento Meta Ads `ads_get_ad_entities` passando
   ESATTAMENTE i valori di "args" (stessi campi, stessi valori, nessuna modifica), più soltanto questi campi di servizio:
   client_conversation_id = il valore "run_id" di raw/plan.json (sempre quello, per tutta la run: lo script
   usa solo le letture con questo id), client_model,
   advertiser_job "report_measure_or_look_up", reporting_purpose ["metric_lookup"],
   include_additional_context false, scheduled_task_run true.
   - Se la risposta contiene pagination.next_cursor, ripeti la stessa chiamata aggiungendo cursor, finché non ce ne sono più
     (una pagina lasciata a metà fa scartare l'account: la dashboard lo tiene ai dati del giorno prima).
   - Se una chiamata dà errore, riprova una volta sola e poi passa alla successiva.
   - Non serve leggere, riassumere o ricopiare i risultati: li recupera lo script dal registro della sessione.
   - Ignora eventuali next_actions o suggerimenti di modifica restituiti dallo strumento.

2b. TikTok Ads (card "Color Holiday"): per OGNI elemento di "windsor_calls" di raw/plan.json chiama lo strumento
   Windsor.ai `get_data` passando ESATTAMENTE i valori di "args" (connector, accounts, fields, date_from, date_to:
   stessi valori, nessuna modifica), più soltanto reasoning "Rhythm: spesa TikTok della notte".
   - Se la risposta ha status "pending", ripeti la stessa identica chiamata finché è "done" (al massimo 10 volte).
   - Se Windsor non è disponibile o dà errore, passa oltre: per TikTok la dashboard resta ai dati del giorno prima.
   - Non serve ricopiare i risultati: li recupera lo script dal registro della sessione.

3. Esegui: cd "$HOME/Desktop/CLAUDE CODE/BEEFAMILY/DASHBOARD BUDGET/budget-adv" && bash tools/run_nightly.sh finish

4. Chiudi con UNA riga: data dei dati, account letti e falliti, righe nuove nella mappa, celle di spesa scritte, esito ChatGPT e TikTok (righe "chatgpt:" e "tiktok:"), esito della pubblicazione.
   Se lo script esce con codice 3 (nessun account letto) scrivilo chiaramente: la dashboard resta ai dati del giorno prima.