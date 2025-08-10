import cv2
import requests
import time

VIDEO_PATH = 'study.mp4'  # Simulated camera source
SERVER_URL = 'http://localhost:3000/upload'  # Adjust to your actual backend

cap = cv2.VideoCapture(VIDEO_PATH)

if not cap.isOpened():
    print("Error: Cannot open video file.")
    exit()

frame_count = 0

while True:
    ret, frame = cap.read()
    if not ret:
        print("End of video, looping...")
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        continue

    # Encode frame to JPEG
    ret, buffer = cv2.imencode('.jpg', frame)
    if not ret:
        print("Error encoding frame.")
        continue
    #cv2.imshow('Streaming Frame', frame)
    print("Frame sent.")

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break
    # Send frame to server
    try:
        headers = {'Content-Type': 'application/octet-stream'}
        requests.post(SERVER_URL, data=buffer.tobytes(), headers=headers, timeout=3)

        #print(f"Sent frame {frame_count} - Status: {response.status_code}")
    except Exception as e:
        print("Error sending frame:", e)

    frame_count += 1
    
    time.sleep(0.3)  # Simulate ~3 FPS stream

cap.release()
