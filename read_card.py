import base64, json, struct, sys

path = sys.argv[1] if len(sys.argv) > 1 else "character_card.png"
d = open(path, "rb").read()
i = 8
while i < len(d):
    n = struct.unpack(">I", d[i:i+4])[0]
    if d[i+4:i+8] == b"tEXt":
        k, v = d[i+8:i+8+n].split(b"\x00", 1)
        if k == b"chara":
            print(json.dumps(json.loads(base64.b64decode(v)), indent=2))
            break
    i += n + 12
