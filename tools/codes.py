"""Cambio di un codice della dashboard senza toccare Apps Script.

  python3 tools/codes.py nuovo marco      (oppure francesco, ambra, routine)

Genera il codice nuovo, manda alla web app solo l'hash (autenticandosi con la chiave della routine),
aggiorna DASHBOARD BUDGET/codici.local.json e, per la routine, il Portachiavi. Il codice nuovo si stampa una volta:
va dato alla persona a voce o in privato, mai in una chat condivisa.
"""
import hashlib
import json
import os
import secrets
import string
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
import routine_api  # noqa: E402

PREFIX = {"francesco": "FRA", "marco": "MAR", "ambra": "AMB"}
CODES_FILE = os.path.join(os.path.dirname(routine_api.ROOT), "codici.local.json")
KEYCHAIN = "budget-adv-routine"


def new_code(role):
    if role == "routine":
        return secrets.token_urlsafe(32)
    if role not in PREFIX:
        raise ValueError("ruolo sconosciuto: %s" % role)
    abc = string.ascii_uppercase + string.digits
    part = lambda: "".join(secrets.choice(abc) for _ in range(4))  # noqa: E731
    return "%s-%s-%s" % (PREFIX[role], part(), part())


def code_hash(code):
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def rotate(role):
    code = new_code(role)
    res = routine_api.post("rotateCodes", {"hashes": {role: code_hash(code)}})  # con la chiave di adesso
    if not res.get("ok") or role not in res.get("changed", []):
        sys.exit("la web app non ha accettato il cambio: %s" % res)
    data = json.load(open(CODES_FILE)) if os.path.exists(CODES_FILE) else {}
    data[role] = code
    with open(CODES_FILE, "w") as f:
        json.dump(data, f, indent=1)
    os.chmod(CODES_FILE, 0o600)
    if role == "routine":
        subprocess.check_call(["security", "add-generic-password", "-U", "-s", KEYCHAIN, "-a", "budget-adv", "-w", code])
    return code


def main():
    if len(sys.argv) != 3 or sys.argv[1] != "nuovo":
        sys.exit("uso: codes.py nuovo francesco|marco|ambra|routine")
    code = rotate(sys.argv[2])
    print("Codice nuovo per %s salvato in codici.local.json." % sys.argv[2])
    if sys.argv[2] != "routine":
        print("Codice: %s (il vecchio non funziona piu')" % code)


if __name__ == "__main__":
    main()
