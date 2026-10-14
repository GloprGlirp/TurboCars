# Posts the commits of a push to Discord as an update note.
# Needs the repository secret DISCORD_WEBHOOK. Commits with [skip discord] in the message are left out.
import json, os, sys, urllib.request

hook = os.environ.get("WEBHOOK", "").strip()
commits = json.loads(os.environ.get("COMMITS") or "[]")
repo = os.environ.get("REPO", "")

notes = []
for c in commits:
    msg = c.get("message", "")
    if "[skip discord]" in msg:
        continue
    lines = [l for l in msg.splitlines() if not l.startswith(("Co-Authored-By", "Claude-Session"))]
    text = "\n".join(lines).strip()
    if text:
        title, _, body = text.partition("\n")
        notes.append("**" + title.strip() + "**" + ("\n" + body.strip() if body.strip() else ""))

if not notes:
    print("nothing to post")
    sys.exit(0)

desc = "\n\n".join(notes)
if len(desc) > 3900:
    desc = desc[:3900].rsplit("\n", 1)[0] + "\n…"
payload = {
    "username": "Pebble Isle Rally",
    "embeds": [{
        "title": "🏁 Neues Update ist live",
        "description": desc,
        "color": 0x9B6BFF,
        "url": f"https://github.com/{repo}" if repo else None,
        "footer": {"text": "Lade das Spiel neu, um das Update zu bekommen"},
    }],
}
if not hook:
    print(json.dumps(payload, ensure_ascii=False, indent=1))
    print("DISCORD_WEBHOOK secret is not set, nothing sent")
    sys.exit(0)
req = urllib.request.Request(hook, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "User-Agent": "PebbleIsleRally-UpdateBot/1.0"})
with urllib.request.urlopen(req, timeout=20) as r:
    print("posted", r.status)
