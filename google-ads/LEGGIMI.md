# Script Google Ads per Rhythm

Lo script `rhythm-google-ads.js` sostituisce l'inserimento a mano dei numeri Google nella dashboard Rhythm.

Ogni notte, per ognuno dei 20 blocchi Google dello Sheet "_BUDGET CLIENTI 2027", legge:
- speso del mese;
- conversioni;
- budget giornaliero delle campagne attive;
- se il blocco è attivo.

Poi li manda alla dashboard con il codice di Marco, come farebbe lui a mano.

Il periodo va dal primo del mese a ieri, come per i dati Meta. Il primo del mese chiude il mese precedente.

## Installazione (account amministratore Google Ads di Marco)

1. Strumenti → Azioni collettive → Script → **+** (nuovo script).
2. Incollare tutto il contenuto di `rhythm-google-ads.js`.
3. In `CONFIG`:
   - `CODICE` (riga 17): il codice personale con cui Marco accede alla dashboard, al posto di `INCOLLA_QUI_IL_TUO_CODICE`, tra gli apici;
   - in `BLOCCHI` c'è una riga per ogni blocco Google: l'ID cliente Google Ads della struttura va nel campo `account`, tra gli apici, nel formato `123-456-7890`. Un ID per riga, niente elenchi. Cristallo, Sardinia e Trieste hanno due righe: lo stesso ID in tutte e due. I blocchi senza account vengono saltati; `channel_id` e `title` restano come sono.

   Esempio: `{ channel_id: 'El Cid|J', title: 'BUDGET GOOGLE ADS', account: '123-456-7890', campagne: [] },`

4. **Anteprima** con `ANTEPRIMA: true`: alla prima esecuzione Google chiede di autorizzare lo script. Nel registro, per ogni blocco, compaiono speso, conversioni, budget e stato, senza inviare niente. Se una campagna finisce in due blocchi compare una riga "ATTENZIONE".
5. Se i numeri tornano: `ANTEPRIMA: false` → **Esegui** una volta → controllo in dashboard.
6. Frequenza: **ogni giorno**, la mattina presto (es. 6:00).

## Standard dei nomi per gli account con due blocchi (11/11/2026)

Le campagne che vanno nel secondo blocco hanno un'etichetta tra parentesi quadre all'inizio del nome:

| Etichetta | Struttura | Blocco |
|---|---|---|
| `[ESTERO]` | Cristallo (poi Albatros e Rivamare) | Google estero |
| `[BARCA]` | Sardinia | gommone |
| `[GAS]` | Trieste | GAS |

Le campagne senza etichetta vanno nel blocco principale (Google, ville). Maiuscole e minuscole indifferenti. Lo script è già configurato così.

## Cosa sapere

- **Lead Google** = colonna "Conversioni" di Google Ads nel periodo, arrotondata all'intero.
- **Budget giornaliero** = somma dei budget giornalieri delle campagne attive. Un budget condiviso conta una volta. I budget a periodo (non giornalieri) non entrano.
- **Spesa Effettiva nello Sheet**: viene scritta come oggi. Un valore inserito a mano non viene sovrascritto.
- **Inserimento a mano**: si può ancora fare dalla dashboard. Per ogni blocco e mese resta una sola riga nel tab GOOGLE, quella con la data più recente.
- **Blocchi nuovi**: se nello Sheet si aggiunge una colonna Google, va aggiunta anche qui, con lo stesso `channel_id` (tab|lettera della colonna) e lo stesso `title` della riga 13.
