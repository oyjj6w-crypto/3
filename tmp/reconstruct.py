import os
import zipfile

with open("tmp/raw_encoded.txt", "r", encoding="utf-8", errors="ignore") as f:
    text = f.read()

print("Text length:", len(text))
print("First 100 chars:", text[:100])
print("Last 100 chars:", text[-100:])

# Let's try to convert to bytes using different encodings
encodings = ["latin1", "utf-8", "cp1252"]
for enc in encodings:
    try:
        data = text.encode(enc, errors="ignore")
        print(f"Encoded with {enc}, byte length: {len(data)}")
        # Check for ZIP signature (PK\x03\x04 or PK)
        if b"PK" in data:
            idx = data.find(b"PK")
            print(f"  Found 'PK' in {enc} at index: {idx}")
            # Try to write to a zip file and test it
            zip_filename = f"tmp/reconstructed_{enc}.zip"
            with open(zip_filename, "wb") as zf:
                zf.write(data)
            try:
                with zipfile.ZipFile(zip_filename, "r") as z:
                    print(f"  Successfully opened ZIP with {enc}! Files: {z.namelist()}")
                    # Extract files to a directory
                    z.extractall("tmp/extracted_logs")
                    print("  EXTRACTED SUCCESSFULLY!")
            except Exception as e:
                print(f"  Failed to parse ZIP for {enc}: {e}")
    except Exception as e:
         print(f"  Encoding error with {enc}: {e}")
