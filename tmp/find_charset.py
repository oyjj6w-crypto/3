with open("tmp/raw_encoded.txt", "r", encoding="utf-8", errors="ignore") as f:
    content = f.read()

# Filter out standard printable characters to see unique alphabet
chars = sorted(list(set(content)))
print("Total unique characters:", len(chars))
print("Characters list:")
print("".join(c for c in chars if ord(c) >= 32))
