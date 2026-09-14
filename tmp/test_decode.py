import base64

# Try to decode a small piece of block 1
data1 = "U5K; -6q. 2uy( 4LWpA!Q xyZr 7L7: Ni?m `MQ2"
try:
    print("Trying a85decode:")
    print(base64.a85decode(data1))
except Exception as e:
    print("a85 error:", e)

try:
    print("Trying b85decode:")
    print(base64.b85decode(data1))
except Exception as e:
    print("b85 error:", e)
