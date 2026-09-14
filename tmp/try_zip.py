import base64
import os

with open("tmp/raw_encoded.txt", "r", encoding="utf-8", errors="ignore") as f:
    raw_content = f.read()

# Let's clean the string and try various decodings of the whole file
clean_content = "".join(raw_content.split())

print("Length of clean content:", len(clean_content))

# Try base64
try:
    decoded = base64.b64decode(clean_content[:1000])
    print("B64 decode start:", decoded[:20])
except Exception as e:
    print("B64 error:", e)

# Try ascii85
try:
    decoded = base64.a85decode(clean_content[:1000])
    print("A85 decode start:", decoded[:20])
except Exception as e:
    print("A85 error:", e)

# Try b85
try:
    decoded = base64.b85decode(clean_content[:1000])
    print("B85 decode start:", decoded[:20])
except Exception as e:
    print("B85 error:", e)
