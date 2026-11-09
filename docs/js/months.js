// Nomi dei mesi: modulo senza dipendenze dalla pagina, così lo usano anche il report e i test.
const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const monthShort = (ym) => `${MESI[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
export const monthLong = (ym) => `${MESI_LUNGHI[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
