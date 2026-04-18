import os
import requests
import time

# HairStep server (hair strand reconstruction)
FACELIFT_URL  = "https://coconut-sublevel-pennant.ngrok-free.dev"

ngrok_url = FACELIFT_URL  # swap to FACELIFT_URL to test FaceLift jobs
image_path = r"C:\Users\stringbot\Documents\Github\HackPrinceton\public\baldified\brunobald_bald.png"

headers = {
    "ngrok-skip-browser-warning": "true",
    "User-Agent": "python-requests/2.31.0"
}

# Submit the job
with open(image_path, 'rb') as f:
    files = {'image': (os.path.basename(image_path), f, 'image/png')}
    response = requests.post(f"{ngrok_url}/process_image", files=files, headers=headers)

result = response.json()
print("Submitted:", result)
if 'job_id' not in result:
    print("Error from server:", result)
    exit(1)
job_id = result['job_id']

# Poll until done
while True:
    status = requests.get(f"{ngrok_url}/status/{job_id}", headers=headers).json()
    print("Status:", status['status'])
    if status['status'] == 'success':
        download = requests.get(f"{ngrok_url}/download/{job_id}", headers=headers)
        with open(os.path.join(os.path.dirname(__file__), "../public/output.ply"), "wb") as f:
            f.write(download.content)
        print("Downloaded output.ply")
        break
    elif status['status'] == 'error':
        print("Error processing job", status['error'], job_id)
    time.sleep(5)