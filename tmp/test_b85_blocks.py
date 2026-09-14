import base64
import re

with open("tmp/raw_encoded.txt", "r", encoding="utf-8", errors="ignore") as f:
    content = f.read()

# Filenames listed in the central directory / logs
filenames = [
    "0_Build Android APK.txt",
    "Build Android APK/system.txt",
    "Build Android APK/1_Set up job.txt",
    "Build Android APK/2_Checkout Repository.txt",
    "Build Android APK/3_Set up JDK 17.txt",
    "Build Android APK/4_Setup Android SDK & Licenses.txt",
    "Build Android APK/5_Setup Gradle 8.10.2.txt",
    "Build Android APK/6_Ensure Gradle Wrapper & Permissions.txt",
    "Build Android APK/7_Assemble Debug APK.txt",
    "Build Android APK/16_Post Setup Gradle 8.10.2.txt",
    "Build Android APK/17_Post Set up JDK 17.txt",
    "Build Android APK/18_Post Checkout Repository.txt",
    "Build Android APK/19_Complete job.txt"
]

# We want to split the content using the filenames as delimiters.
# Let's escape the filenames to use them in a regex pattern.
pattern = "|".join(re.escape(fn) for fn in filenames)
parts = re.split(f"({pattern})", content)

print("Total parts found:", len(parts))

# The first part might be empty or preamble.
# Subsequent parts will alternate between filename and block content.
decoded_files = {}
current_filename = None

# RFC 1924 Base85 characters
b85_chars = set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~")

for part in parts:
    part = part.strip()
    if not part:
        continue
    if part in filenames:
        current_filename = part
    elif current_filename:
        # Clean the block: remove any character not in RFC 1924 Base85
        cleaned = "".join(c for c in part if c in b85_chars)
        print(f"Decoding {current_filename} (cleaned len={len(cleaned)})...")
        try:
            # base64.b85decode requires the input to have a length multiple of 5 if padded, or we can pad it if needed
            # b85 padding: usually, if length % 5 != 0, it might be incomplete. Let's try to decode as is, or try with padding.
            for pad in range(5):
                try:
                    test_str = cleaned + "u" * pad
                    decoded = base64.b85decode(test_str)
                    print(f"  Success with padding {pad}! Output length: {len(decoded)}")
                    # Let's save the decoded data
                    decoded_files[current_filename] = decoded
                    break
                except Exception as e:
                    if pad == 4:
                        print(f"  Failed all paddings: {e}")
        except Exception as e:
            print(f"  Error: {e}")

# Save decoded files
import os
os.makedirs("tmp/decoded_b85", exist_ok=True)
for fn, data in decoded_files.items():
    # sanitize filename
    safe_fn = fn.replace("/", "_")
    with open(f"tmp/decoded_b85/{safe_fn}", "wb") as out_f:
        out_f.write(data)
    print(f"Saved tmp/decoded_b85/{safe_fn}")
