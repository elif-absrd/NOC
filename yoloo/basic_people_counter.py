from ultralytics import YOLO
import cv2
import time

model = YOLO('yolov8n.pt')  # Or use 'yolov8s.pt' for better accuracy

cap = cv2.VideoCapture("rtmp://localhost:1935/live/stream")

if not cap.isOpened():
    print("❌ Cannot open RTMP stream.")
    exit()

frame_count = 0
frame_skip = 2  # Every 2nd frame
confidence_threshold = 0.5  # Confidence threshold

while True:
    ret, frame = cap.read()
    if not ret:
        print("❌ Failed to read frame.")
        break

    frame_count += 1
    if frame_count % frame_skip != 0:
        continue

    # Detect only 'person' class
    results = model(frame, classes=[0])

    # Count confident person detections
    people_count = 0
    for r in results:
        for box in r.boxes:
            if box.conf[0] > confidence_threshold:
                people_count += 1

    print(f"👀 People Detected: {people_count} {'⚠ THREAT' if people_count > 10 else ''}")

    # Show annotated frame
    annotated = results[0].plot()
    cv2.imshow("Threat Detection Stream", annotated)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

    time.sleep(0.1)

cap.release()
cv2.destroyAllWindows()