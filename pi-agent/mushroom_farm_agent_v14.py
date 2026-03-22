# mushroom_farm_agent_v14.py
#
# v14 CHANGES (from v13):
# CLOUD SYNC:
#   - All sensor data, vision results, AI decisions, and photos pushed to
#     AgriVision cloud platform via api_sync.AgriVisionSync
#   - Cloud commands polled every 30s alongside Telegram (START_FRUITING,
#     ENABLE_AUTO, DISABLE_AUTO, FORCE_MIST, FORCE_FAN)
#   - Cloud is additive — ALL existing v13 functionality preserved
#     (Telegram, Google Sheets, Google Drive, Flask dashboard, Tapo control)
#   - Every sync call wrapped in try/except — agent never crashes if cloud
#     is unreachable
# ENERGY METERING:
#   - Reads kWh from Tapo P110 smart plugs after each device toggle
#   - task_energy_monitor() runs every 30min for continuous tracking
#   - Pushes to /api/agent/energy with auto-calculated cost (kr)
#   - All energy calls wrapped in try/except — never crashes
# ENV:
#   - API_URL, API_KEY, ZONE_ID, FARM_ID loaded from .env file (python-dotenv)
#   - Falls back to os.environ if .env not present
#
import asyncio, anthropic, requests, base64, time, os, gspread, json, threading
import pyrealsense2 as rs
import cv2
from datetime import datetime, timedelta
from tapo import ApiClient
from google.oauth2.service_account import Credentials as ServiceCredentials
from google.oauth2.credentials import Credentials as UserCredentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from PIL import Image, ImageEnhance
import numpy as np
from flask import Flask, Response, jsonify

# ==================== CLOUD SYNC (v14) ====================
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass  # python-dotenv not installed, use os.environ directly

from api_sync import AgriVisionSync

CLOUD_API_URL = os.environ.get("API_URL", "")
CLOUD_API_KEY = os.environ.get("API_KEY", "")
CLOUD_ZONE_ID = os.environ.get("ZONE_ID", "")
CLOUD_FARM_ID = os.environ.get("FARM_ID", "")

sync = None  # initialized in main() after validation

def _init_cloud_sync():
    """Initialize cloud sync. Returns AgriVisionSync or None if not configured."""
    global sync
    if not CLOUD_API_URL or not CLOUD_API_KEY or not CLOUD_ZONE_ID:
        print("⚠️ Cloud sync not configured (set API_URL, API_KEY, ZONE_ID in .env)")
        return None
    try:
        sync = AgriVisionSync(CLOUD_API_URL, CLOUD_API_KEY, CLOUD_ZONE_ID)
        # Test connectivity
        sync.check_models("oyster")
        print(f"☁️  Cloud sync connected: {CLOUD_API_URL}")
        return sync
    except Exception as e:
        print(f"⚠️ Cloud sync failed to connect: {e}")
        sync = AgriVisionSync(CLOUD_API_URL, CLOUD_API_KEY, CLOUD_ZONE_ID)
        print(f"☁️  Cloud sync initialized (offline mode): {CLOUD_API_URL}")
        return sync

# ==================== CONFIGURATION ====================
ANTHROPIC_API_KEY  = os.environ.get("ANTHROPIC_API_KEY", "")
TELEGRAM_TOKEN     = os.environ.get("TELEGRAM_TOKEN", "")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")
GOOGLE_CREDS_FILE  = "/home/pi/mushroom_farm/google_credentials.json"
GOOGLE_SHEET_ID    = "1_gf_1GkP49MHPwM4QJTb6iVRy7UGR4M8PpKcfgSQTuw"
GOOGLE_SHEET_TAB   = "Mushroom Farm Log"
GOOGLE_SCOPES      = ['https://www.googleapis.com/auth/spreadsheets',
                      'https://www.googleapis.com/auth/drive']
GOOGLE_DRIVE_FOLDER_ID = "1dPW2kukIT51gWsebaPU0IoLJnm6GPgyM"
GOOGLE_DRIVE_TOKEN     = "/home/pi/mushroom_farm/drive_token.json"
ESP32_URL          = "http://192.168.0.44"
ESP32_TIMEOUT      = 10
TAPO_EMAIL         = "gian_pc21@hotmail.com"
TAPO_PASSWORD      = "Lacamisanegra123"
PLUG_FAN_IP        = "192.168.0.42"
PLUG_HUMID_IP      = "192.168.0.43"
PLUG_LIGHT_IP      = "192.168.0.45"
PHOTOS_DIR         = "/home/pi/mushroom_farm/photos"
PHASE_FILE         = "/home/pi/mushroom_farm/current_phase.txt"
OFFLINE_ALERTS_FILE = "/home/pi/mushroom_farm/offline_alerts.txt"

# RealSense D435
RS_WIDTH, RS_HEIGHT, RS_FPS = 1280, 720, 30

LIGHT_DARK_START = 18
LIGHT_DARK_END   = 7

SENSOR_INTERVAL_COLONIZATION = 600   # 10 min passive
SENSOR_INTERVAL_FRUITING     = 300   # 5 min active
PHOTO_INTERVAL               = 14400 # 4 hours
VISION_INTERVAL_COLONIZATION = 86400 # 24 hours
VISION_INTERVAL_FRUITING     = 21600 # 6 hours
FRESH_AIR_INTERVAL           = 1800  # 30 min

TARGET_HUM_MIN    = 84
TARGET_HUM_MAX    = 92
EMERGENCY_HUM_LOW = 75
EMERGENCY_HUM_HIGH= 95
DEVICE_DURATION   = 20
FRESH_AIR_DURATION= 15
FAN_COOLDOWN      = 120

# ==================== STATE ====================
def load_phase():
    try:
        with open(PHASE_FILE) as f:
            p = f.read().strip()
        return p if p in ("colonization","fruiting") else "colonization"
    except Exception: return "colonization"

def save_phase(p):
    try:
        os.makedirs(os.path.dirname(PHASE_FILE), exist_ok=True)
        with open(PHASE_FILE, "w") as f:
            f.write(p)
    except Exception as e: print(f"⚠️ save_phase: {e}")

GROWTH_PHASE = load_phase()
AUTOMATIC_MODE = True
BATCH_NUMBER   = None

waiting_for_fruiting_confirmation = False
fruiting_confirmation_requested_at = None
waiting_for_pins = False
fruiting_started_at = None
phase_started_at = datetime.now()

action_history = []
HISTORY_SIZE   = 20
sheets_client  = None
last_telegram_update_id = 0
last_fan_time  = 0.0
last_sensor_ok = 0.0
last_photo_time = 0.0
last_reminder_sent_at = None

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ==================== HELPERS ====================
def ts(): return datetime.now().strftime('%Y-%m-%d %H:%M:%S')
def is_dark(): h = datetime.now().hour; return h >= LIGHT_DARK_START or h < LIGHT_DARK_END

def init_sheets():
    global sheets_client, drive_service
    try:
        sa_creds = ServiceCredentials.from_service_account_file(GOOGLE_CREDS_FILE,
            scopes=['https://www.googleapis.com/auth/spreadsheets'])
        sheets_client = gspread.authorize(sa_creds)
        print("✅ Google Sheets connected")
        with open(GOOGLE_DRIVE_TOKEN) as f:
            token_data = json.load(f)
        drive_creds = UserCredentials(
            token=token_data['token'],
            refresh_token=token_data['refresh_token'],
            token_uri=token_data['token_uri'],
            client_id=token_data['client_id'],
            client_secret=token_data['client_secret'],
            scopes=token_data.get('scopes', ['https://www.googleapis.com/auth/drive'])
        )
        if drive_creds.expired or not drive_creds.valid:
            drive_creds.refresh(Request())
            token_data['token'] = drive_creds.token
            with open(GOOGLE_DRIVE_TOKEN, 'w') as f:
                json.dump(token_data, f, indent=2)
        drive_service = build('drive', 'v3', credentials=drive_creds)
        print(f"✅ Google Drive connected (OAuth, folder: {GOOGLE_DRIVE_FOLDER_ID[:12]}...)")
        return True
    except Exception as e:
        print(f"⚠️ Google services failed: {e}"); return False

drive_service = None

def log(data):
    try:
        if not sheets_client and not init_sheets(): return
        sheet = sheets_client.open_by_key(GOOGLE_SHEET_ID).worksheet(GOOGLE_SHEET_TAB)
        row = [BATCH_NUMBER] + [data.get(k,'') for k in [
            'timestamp','temperature','humidity','battery',
            'photo_taken','claude_decision','claude_reasoning','action_executed',
            'recent_history','photo_path','data_age_seconds','visual_analysis',
            'check_type','automatic_mode']]
        sheet.append_row(row, value_input_option='RAW')
        print("   ✅ Logged to Sheets")
    except Exception as e: print(f"   ⚠️ Logging error: {e}")

def send_alert(msg):
    try:
        requests.post(f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
            data={"chat_id": TELEGRAM_CHAT_ID, "text": f"🍄 Mushroom Farm\n\n{msg}"}, timeout=10)
        print("   📲 Alert sent")
    except Exception:
        try:
            with open(OFFLINE_ALERTS_FILE,"a") as f:
                f.write(f"{ts()} UNSENT: {msg}\n")
        except Exception: pass

def add_history(action, reason, sensors, mode="AUTO"):
    action_history.append({"timestamp":ts(),"action":action,"reason":reason,
        "temp":sensors['temperature'],"humidity":sensors['humidity'],"mode":mode})
    if len(action_history) > HISTORY_SIZE: action_history.pop(0)

def history_summary():
    if not action_history: return "No history"
    return "\n".join([f"{e['timestamp']}: {'🤖' if e['mode']=='AUTO' else '🧠'} {e['action']} "
        f"(H:{e['humidity']}%) - {e['reason']}" for e in action_history[-10:]])

def check_failures(humidity):
    if len(action_history) < 4: return None, False
    recent = action_history[-4:]
    mist_n = sum(1 for a in recent if 'AUTO_MIST' in a['action'] or 'CLAUDE_MIST' in a['action'])
    fan_n  = sum(1 for a in recent if 'AUTO_FAN'  in a['action'] or 'CLAUDE_FAN'  in a['action'])
    if mist_n >= 4 and humidity < TARGET_HUM_MIN:
        return f"⚠️ EQUIPMENT FAILURE\n\nHumidifier ran {mist_n}× but humidity still {humidity}%\n\nCheck water tank!\n\nReply 'fixed' to resume.", True
    if fan_n >= 4 and humidity > TARGET_HUM_MAX:
        return f"⚠️ EQUIPMENT FAILURE\n\nFan ran {fan_n}× but humidity still {humidity}%\n\nCheck fan!\n\nReply 'fixed' to resume.", True
    return None, False

# ==================== TAPO DEVICE CONTROL ====================
_tapo_client = None

async def _call_tapo(ip, action):
    global last_fan_time, _tapo_client
    for attempt in range(2):
        try:
            if _tapo_client is None:
                _tapo_client = ApiClient(TAPO_EMAIL, TAPO_PASSWORD)
            dev = await _tapo_client.p110(ip)
            if action == "on":  await dev.on()
            else:               await dev.off()
            if ip == PLUG_FAN_IP and action == "on":
                last_fan_time = time.time()
            return True
        except Exception as e:
            if attempt == 0:
                print(f"   🔄 Tapo {ip} reconnecting...")
                _tapo_client = None
                await asyncio.sleep(2)
            else:
                print(f"   ❌ Tapo {ip} error: {e}"); return False
    return False

_IP_TO_DEVICE = {
    PLUG_FAN_IP: ("FAN", "Exhaust Fan"),
    PLUG_HUMID_IP: ("HUMIDIFIER", "Main Humidifier"),
    PLUG_LIGHT_IP: ("LIGHT", "Grow Light"),
}

def _sync_device_state(ip, is_on):
    """Push device state to cloud (non-blocking, best-effort)."""
    try:
        if sync and ip in _IP_TO_DEVICE:
            device_type, device_name = _IP_TO_DEVICE[ip]
            sync.push_device_state(device_type, device_name, is_on)
    except Exception as e:
        print(f"   ☁️  Device state sync failed: {e}")

_IP_TO_ENERGY_NAME = {
    PLUG_FAN_IP: "fan",
    PLUG_HUMID_IP: "humidifier",
    PLUG_LIGHT_IP: "light",
}

async def _read_and_push_energy(ip):
    """Read energy from Tapo P110 plug and push to cloud. Best-effort, never crashes."""
    try:
        if not sync or not CLOUD_FARM_ID:
            return
        if _tapo_client is None:
            return
        dev = await _tapo_client.p110(ip)
        usage = await dev.get_energy_usage()
        # usage typically has: current_power (W), today_energy (Wh), month_energy (Wh)
        today_wh = getattr(usage, 'today_energy', 0) or 0
        if hasattr(usage, 'today_energy') and today_wh == 0:
            # Try dict access if it's a dict-like object
            if isinstance(usage, dict):
                today_wh = usage.get('today_energy', 0)
        today_kwh = today_wh / 1000.0
        if today_kwh > 0:
            device_name = _IP_TO_ENERGY_NAME.get(ip, "unknown")
            sync.push_energy(CLOUD_FARM_ID, CLOUD_ZONE_ID or None, device_name, today_kwh)
    except Exception as e:
        print(f"   ⚡ Energy read failed ({ip}): {e}")

async def run_device(ip, duration, icon, label):
    print(f"{icon} {label} ON for {duration}s")
    if await _call_tapo(ip, "on"):
        _sync_device_state(ip, True)
        await asyncio.sleep(duration)
        await _call_tapo(ip, "off")
        _sync_device_state(ip, False)
        print(f"{icon} {label} OFF")
        await _read_and_push_energy(ip)

async def fan(duration=DEVICE_DURATION):   await run_device(PLUG_FAN_IP,   duration, "🌀", "Fan")
async def humid(duration=DEVICE_DURATION): await run_device(PLUG_HUMID_IP, duration, "💧", "Humidifier")

async def light(state="on", duration=None):
    if await _call_tapo(PLUG_LIGHT_IP, state):
        _sync_device_state(PLUG_LIGHT_IP, state == "on")
        print(f"💡 Light {'ON' + (f' for {duration}s' if duration else '') if state=='on' else 'OFF'}")
        if state == "off":
            await _read_and_push_energy(PLUG_LIGHT_IP)
        if state == "on" and duration:
            await asyncio.sleep(duration)
            await _call_tapo(PLUG_LIGHT_IP, "off")
            _sync_device_state(PLUG_LIGHT_IP, False)
            print("💡 Light OFF")
            await _read_and_push_energy(PLUG_LIGHT_IP)

# ==================== SENSOR ====================
def get_sensor():
    global last_sensor_ok
    try:
        r = requests.get(f"{ESP32_URL}/sensor", timeout=ESP32_TIMEOUT)
        if r.status_code == 200:
            d = r.json()
            if d.get('sensor_ok'):
                last_sensor_ok = time.time()
                return {"temperature": d['temperature'], "humidity": d['humidity'], "battery": 100}
        print("⚠️ ESP32 sensor not initialized")
    except requests.exceptions.Timeout:   print(f"⚠️ ESP32 timeout")
    except requests.exceptions.ConnectionError: print(f"⚠️ Cannot connect to ESP32")
    except Exception as e: print(f"⚠️ ESP32 error: {e}")
    return None

# ==================== PHOTO ====================
def preprocess(path):
    try:
        print("   🔧 Preprocessing...")
        img = Image.open(path)
        w, h = img.size
        img = img.crop((int(w*.20), int(h*.25), int(w*.75), int(h*.90)))
        nw, nh = img.size
        print(f"      📦 {w}x{h} → {nw}x{nh}px")
        arr = np.array(img).astype(float)
        r, g, b = arr[:,:,0], arr[:,:,1], arr[:,:,2]
        wm = (r>160)&(g>160)&(b>160)&(np.abs(r-g)<25)&(np.abs(g-b)<25)
        gm = (g>r+15)&(g>b+15)&(g>60)
        keep = wm|gm
        tot = arr.shape[0]*arr.shape[1]
        gray = 0.299*r + 0.587*g + 0.114*b
        arr[~keep,0]=arr[~keep,1]=arr[~keep,2]=gray[~keep]
        arr[wm] = np.clip(arr[wm]*1.2,0,255)
        arr[gm,1] = np.clip(arr[gm,1]*1.5,0,255)
        img = Image.fromarray(np.clip(arr,0,255).astype(np.uint8))
        wp, gp = np.sum(wm)/tot*100, np.sum(gm)/tot*100
        print(f"      🎨 {wp:.1f}% white, {gp:.1f}% green, {100-wp-gp:.1f}% gray")
        img = ImageEnhance.Color(img).enhance(0.95)
        img = ImageEnhance.Contrast(img).enhance(1.1)
        out = path.replace('.jpg','_processed.jpg')
        img.save(out, quality=95)
        print(f"      ✅ {os.path.basename(out)}")
        return out
    except Exception as e:
        print(f"      ⚠️ Preprocess failed: {e}"); return path

# ==================== REALSENSE CAMERA ====================
class RealSenseCamera:
    def __init__(self):
        self.pipeline = None
        self.align = None
        self.depth_scale = None
        self.running = False
        self.last_error = None
        self.frame_count = 0
        self.lock = threading.Lock()

    def start(self):
        try:
            self.pipeline = rs.pipeline()
            config = rs.config()
            config.enable_stream(rs.stream.color, RS_WIDTH, RS_HEIGHT, rs.format.bgr8, RS_FPS)
            config.enable_stream(rs.stream.depth, RS_WIDTH, RS_HEIGHT, rs.format.z16, RS_FPS)
            profile = self.pipeline.start(config)
            dev = profile.get_device()
            self.depth_scale = dev.first_depth_sensor().get_depth_scale()
            self.align = rs.align(rs.stream.color)
            print("   ⏳ Camera warming up...", end="", flush=True)
            for i in range(15):
                self.pipeline.wait_for_frames()
                print(".", end="", flush=True)
            print(" done!")
            self.running = True
            usb = dev.get_info(rs.camera_info.usb_type_descriptor)
            fw = dev.get_info(rs.camera_info.firmware_version)
            print(f"   📷 RealSense D435: USB {usb}, FW {fw}, {RS_WIDTH}x{RS_HEIGHT}@{RS_FPS}fps")
            return True
        except Exception as e:
            self.last_error = str(e)
            print(f"   ❌ Camera failed: {e}"); return False

    def capture(self):
        if not self.running: return None, None
        with self.lock:
            try:
                frames = self.pipeline.wait_for_frames(5000)
                aligned = self.align.process(frames)
                cf, df = aligned.get_color_frame(), aligned.get_depth_frame()
                if not cf or not df: return None, None
                self.frame_count += 1
                return np.asanyarray(cf.get_data()), np.asanyarray(df.get_data())
            except Exception as e:
                self.last_error = str(e); return None, None

    def stop(self):
        if self.pipeline: self.pipeline.stop()
        self.running = False

camera = RealSenseCamera()

_upload_queue = []
_upload_lock = threading.Lock()

def _upload_worker():
    while True:
        filepath = None
        with _upload_lock:
            if _upload_queue:
                filepath = _upload_queue.pop(0)
        if filepath:
            if not drive_service or not GOOGLE_DRIVE_FOLDER_ID:
                continue
            try:
                media = MediaFileUpload(filepath, resumable=True)
                drive_service.files().create(
                    body={'name': os.path.basename(filepath), 'parents': [GOOGLE_DRIVE_FOLDER_ID]},
                    media_body=media, fields='id').execute()
                print(f"   ☁️  Uploaded: {os.path.basename(filepath)}")
            except Exception as e:
                print(f"   ⚠️ Drive upload: {e}")
        else:
            time.sleep(2)

threading.Thread(target=_upload_worker, daemon=True).start()

def upload_async(filepath):
    with _upload_lock:
        _upload_queue.append(filepath)

def cleanup_local(keep=20):
    try:
        files = sorted([os.path.join(PHOTOS_DIR, f) for f in os.listdir(PHOTOS_DIR)],
                       key=os.path.getmtime, reverse=True)
        for f in files[keep:]: os.remove(f)
    except Exception: pass

def capture_raw():
    try:
        print("📸 Capturing from RealSense D435...")
        color, depth = camera.capture()
        if color is None:
            print("   ⚠️ Capture failed"); return None, None
        os.makedirs(PHOTOS_DIR, exist_ok=True)
        stamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        raw_path = os.path.join(PHOTOS_DIR, f"{stamp}_raw.jpg")
        cv2.imwrite(raw_path, color, [cv2.IMWRITE_JPEG_QUALITY, 95])
        print(f"   📷 Raw: {os.path.basename(raw_path)}")
        depth_path = os.path.join(PHOTOS_DIR, f"{stamp}_depth.npy")
        np.save(depth_path, depth)
        valid = depth[depth > 0]
        if len(valid) > 0:
            print(f"   📏 Depth: median {np.median(valid):.0f}mm")
        proc = preprocess(raw_path)
        upload_async(raw_path)
        upload_async(proc)
        upload_async(depth_path)
        cleanup_local()
        return base64.b64encode(open(proc,'rb').read()).decode(), proc
    except Exception as e:
        print(f"   ⚠️ Camera error: {e}")
    return None, None

async def capture_photo():
    need_light = GROWTH_PHASE == "colonization" or is_dark()
    if need_light:
        print("💡 Light ON for photo")
        await light("on"); await asyncio.sleep(2)
    photo, path = capture_raw()
    if need_light:
        print("💡 Light OFF")
        await light("off")
    return photo, path

def save_reference(photo_b64, phase):
    try:
        os.makedirs(PHOTOS_DIR, exist_ok=True)
        if phase == "colonization":
            fname = f"reference_colonization_{datetime.now().strftime('%Y-%m-%d')}.jpg"
        else:
            fname = f"reference_fruiting_{datetime.now().strftime('%Y-%m-%d_%H')}.jpg"
        with open(os.path.join(PHOTOS_DIR, fname), 'wb') as f:
            f.write(base64.b64decode(photo_b64))
        print(f"   💾 Saved reference: {fname}")
    except Exception as e: print(f"   ⚠️ save_reference: {e}")

def get_comparison(phase):
    import glob
    try:
        prefix = "reference_colonization_" if phase == "colonization" else "reference_fruiting_"
        min_age_hours = 20 if phase == "colonization" else 4
        pattern = os.path.join(PHOTOS_DIR, f"{prefix}*.jpg")
        files = sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
        now = time.time()
        for fp in files:
            age_hours = (now - os.path.getmtime(fp)) / 3600
            if age_hours >= min_age_hours:
                print(f"   📷 Found comparison: {os.path.basename(fp)} ({age_hours:.0f}h old)")
                with open(fp, 'rb') as f:
                    return base64.b64encode(f.read()).decode()
        if files:
            print(f"   ⚠️ Reference exists but too recent ({len(files)} files)")
        else:
            print(f"   ⚠️ No reference photos yet")
        return None
    except Exception as e:
        print(f"   ⚠️ get_comparison: {e}"); return None

# ==================== CLAUDE VISION ====================
def _claude_call(content):
    for attempt in range(3):
        try:
            r = client.messages.create(model="claude-sonnet-4-20250514", max_tokens=500,
                messages=[{"role":"user","content":content}])
            txt = r.content[0].text.strip()
            for fence in ("```json","```"):
                if fence in txt: txt = txt.split(fence)[1].split("```")[0].strip(); break
            return json.loads(txt)
        except Exception as e:
            print(f"      ⚠️ API attempt {attempt+1}: {e}")
            if attempt < 2: time.sleep(2)
    return None

def _imgs(current, comparison=None, diff="24 hours"):
    c = []
    if comparison:
        c += [{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":comparison}},
              {"type":"text","text":f"PHOTO 1 (taken {diff} ago)"}]
    c += [{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":current}},
          {"type":"text","text":"PHOTO 2 (now)" if comparison else "Current photo"}]
    return c

def identify_bag(photo):
    print("      📦 Identifying bag...")
    r = _claude_call(_imgs(photo) + [{"type":"text","text":
        'Locate the grow bag (plastic bag with substrate). Ignore container, rulers, background.\n'
        'JSON only: {"bag_found":true,"focus_instruction":"where to look in analysis"}'}])
    if r and r.get('bag_found'):
        print(f"         ✅ Bag found"); return r.get('focus_instruction','')
    print("         ⚠️ Bag not found"); return ""

def check_patches(cur, comp, diff, focus):
    print("      🔬 Check 1: Patch counting...")
    fi = f"\nFOCUS: {focus}" if focus else ""
    if comp:
        prompt = (f"Count distinct WHITE FUZZY mycelium patches in each photo.{fi}\n"
            f"Photo 1={diff} ago. Photo 2=now.\n"
            'JSON: {"patches_photo1":0,"patches_photo2":0,"estimated_white_coverage_photo1":0,"estimated_white_coverage_photo2":0}')
    else:
        prompt = (f"Count WHITE FUZZY mycelium patches.{fi}\n"
            'JSON: {"patches":0,"estimated_white_coverage":0}')
    r = _claude_call(_imgs(cur,comp,diff)+[{"type":"text","text":prompt}])
    if r:
        cov = r.get('estimated_white_coverage_photo2' if comp else 'estimated_white_coverage', 0)
        print(f"         Coverage: {cov}%")
    return r

def check_brown(cur, comp, diff, focus):
    print("      🟤 Check 2: Brown area...")
    fi = f"\nFOCUS: {focus}" if focus else ""
    if comp:
        prompt = (f"Estimate % of bag that is BROWN (uncolonized substrate).{fi}\n"
            f"Photo 1={diff} ago. Photo 2=now.\n"
            'JSON: {"brown_percent_photo1":0,"brown_percent_photo2":0,"confidence":"low"}')
    else:
        prompt = f"Estimate % of bag that is BROWN.{fi}\nJSON: {{\"brown_percent\":0,\"confidence\":\"low\"}}"
    r = _claude_call(_imgs(cur,comp,diff)+[{"type":"text","text":prompt}])
    if r:
        brown = r.get('brown_percent_photo2' if comp else 'brown_percent', 100)
        print(f"         Brown: {brown}% → coverage: {100-brown}%")
    return r

def check_regional(cur, comp, diff, focus):
    print("      📐 Check 3: Regional...")
    fi = (f"\nFOCUS: {focus}\nDivide ONLY the grow bag into 4 quadrants." if focus else "")
    prompt = (f"Divide grow bag into 4 quadrants, estimate % white fuzzy mycelium each.{fi}\n"
        "CONTAMINATION: only flag ROUND/FUZZY shapes, ignore pixelated artifacts.\n"
        'JSON: {"top_left_coverage":0,"top_right_coverage":0,"bottom_left_coverage":0,'
        '"bottom_right_coverage":0,"any_green_or_yellow":false,"contamination_description":"",'
        '"contamination_shape":""}')
    r = _claude_call(_imgs(cur,comp,diff)+[{"type":"text","text":prompt}])
    if r:
        quads = [r.get(k,0) for k in ('top_left_coverage','top_right_coverage','bottom_left_coverage','bottom_right_coverage')]
        print(f"         TL:{quads[0]}% TR:{quads[1]}% BL:{quads[2]}% BR:{quads[3]}% → Avg:{sum(quads)/4:.0f}%")
    return r

last_known_coverage = 0

def triple_colonization(sensors, cur, comp, check_type="scheduled"):
    global last_known_coverage
    diff = "24 hours"
    print(f"   🔬 TRIPLE SAMPLING (colonization) — {'comparative' if comp else 'single'}")
    focus = identify_bag(cur) or ""
    r1, r2, r3 = check_patches(cur,comp,diff,focus), check_brown(cur,comp,diff,focus), check_regional(cur,comp,diff,focus)
    coverages, details = [], {}
    if r1:
        c = r1.get('estimated_white_coverage_photo2' if comp else 'estimated_white_coverage')
        if c is not None: coverages.append(c); details['c1'] = c
    if r2:
        brown = r2.get('brown_percent_photo2' if comp else 'brown_percent')
        if brown is not None: c = 100-brown; coverages.append(c); details['c2'] = c
    if r3:
        c = sum(r3.get(k,0) for k in ('top_left_coverage','top_right_coverage','bottom_left_coverage','bottom_right_coverage'))/4
        coverages.append(c); details['c3'] = round(c,1)
    raw = sum(coverages)/len(coverages) if coverages else last_known_coverage
    final = max(raw, last_known_coverage)
    if final != raw: print(f"   ⚠️ Monotonic: {raw:.0f}% → {final:.0f}%")
    last_known_coverage = final
    stage = "early" if final<25 else "mid" if final<60 else "late" if final<90 else "fully_colonized"
    contamination, cont_desc = False, ""
    if r3 and r3.get('any_green_or_yellow'):
        shape = r3.get('contamination_shape','')
        if shape != 'pixelated_artifact':
            contamination = True; cont_desc = r3.get('contamination_description','Suspicious growth')
    spread = (max(coverages)-min(coverages)) if len(coverages)>1 else 0
    conf = "high" if spread<15 else "medium" if spread<30 else "low"
    print(f"\n   📊 RESULT: {final:.0f}% [{details.get('c1','?')}/{details.get('c2','?')}/{details.get('c3','?')}] "
          f"spread:{spread:.0f}% conf:{conf} stage:{stage}")
    if contamination: decision, reasoning = "ALERT_HUMAN", f"CONTAMINATION: {cont_desc}"
    elif stage == "fully_colonized": decision, reasoning = "ALERT_HUMAN", f"Fully colonized at {final:.0f}%"
    elif check_type == "emergency_low": decision, reasoning = "MIST", f"Emergency low {sensors['humidity']}%"
    elif check_type == "emergency_high": decision, reasoning = "FAN", f"Emergency high {sensors['humidity']}%"
    else: decision, reasoning = "WAIT", f"Coverage: {final:.0f}% ({stage})"
    return {"phase":"colonization","coverage_percent":round(final,1),"check1_result":details.get('c1'),
        "check2_result":details.get('c2'),"check3_result":details.get('c3'),
        "spread":round(spread,1),"confidence":conf,"colonization_stage":stage,
        "decision":decision,"reasoning":reasoning,"health_score":8 if not contamination else 3,
        "contamination_detected":contamination,"contamination_description":cont_desc}

def analyze_fruiting(sensors, cur, comp, check_type="scheduled"):
    print("   🍄 FRUITING ANALYSIS")
    diff = "6 hours"
    prefix = ""
    if check_type == "emergency_low":  prefix = f"🚨 EMERGENCY: {sensors['humidity']}% critically LOW.\n"
    if check_type == "emergency_high": prefix = f"🚨 EMERGENCY: {sensors['humidity']}% critically HIGH.\n"
    prompt = (f"{prefix}Mushroom fruiting body analysis.\n"
        f"CONDITIONS: {sensors['temperature']}°C, {sensors['humidity']}%  TARGET: 85-90%\n"
        f"{'Compare Photo 1 (6h ago) to Photo 2 (now).' if comp else 'Analyze this photo.'}\n"
        'JSON: {"mushroom_count":0,"avg_cap_size_cm":0,'
        '"development_stage":"pinning|young_fruiting|mature|ready_harvest",'
        '"decision":"MIST|FAN|WAIT|ALERT_HUMAN","reasoning":"","health_score":0,'
        '"pin_count":0,"contamination_detected":false}\n'
        'Decision: <85%→MIST, >90%→FAN, 85-90%→WAIT, problems→ALERT_HUMAN')
    r = _claude_call(_imgs(cur,comp,diff)+[{"type":"text","text":prompt}])
    if not r: r = {"decision":"WAIT","reasoning":"API error","health_score":0}
    r["phase"] = "fruiting"
    return r

# ==================== DEVICE EXECUTION ====================
async def execute_decision(decision, reasoning, sensors, photo=None, path=None):
    global AUTOMATIC_MODE, last_fan_time
    action = "NONE"
    if decision == "MIST":
        if GROWTH_PHASE == "fruiting": await humid(DEVICE_DURATION); action=f"CLAUDE_MIST_{DEVICE_DURATION}s"; add_history("CLAUDE_MIST",reasoning,sensors,"CLAUDE")
        else: action="CLAUDE_MIST_SKIPPED"; add_history("CLAUDE_MIST_SKIPPED","Colonization - no misting",sensors,"CLAUDE")
    elif decision == "FAN":
        if GROWTH_PHASE == "fruiting": await fan(DEVICE_DURATION); action=f"CLAUDE_FAN_{DEVICE_DURATION}s"; add_history("CLAUDE_FAN",reasoning,sensors,"CLAUDE")
        else: action="CLAUDE_FAN_SKIPPED"; add_history("CLAUDE_FAN_SKIPPED","Colonization - no fans",sensors,"CLAUDE")
    elif decision == "ALERT_HUMAN":
        send_alert(f"🚨 ALERT\n\n{reasoning}"); action="ALERT_HUMAN"; add_history("ALERT_HUMAN",reasoning,sensors,"CLAUDE")
    elif decision == "DISABLE_AUTO":
        AUTOMATIC_MODE=False; send_alert(f"🔴 AUTO DISABLED\n\n{reasoning}\n\nReply 'enable' to resume.")
        action="DISABLE_AUTO"; add_history("DISABLE_AUTO",reasoning,sensors,"CLAUDE")
    elif decision == "ENABLE_AUTO":
        AUTOMATIC_MODE=True; send_alert(f"🟢 AUTO ENABLED\n\n{reasoning}")
        action="ENABLE_AUTO"; add_history("ENABLE_AUTO",reasoning,sensors,"CLAUDE")
    else:
        action="CLAUDE_WAIT"; add_history("CLAUDE_WAIT",reasoning,sensors,"CLAUDE")
    return action, path

# ==================== INDEPENDENT TASKS ====================

async def task_sensor_control():
    """Runs every 5min (fruiting) or 10min (colonization). Never blocks fresh air."""
    global AUTOMATIC_MODE, last_fan_time
    while True:
        interval = SENSOR_INTERVAL_COLONIZATION if GROWTH_PHASE=="colonization" else SENSOR_INTERVAL_FRUITING
        await asyncio.sleep(interval)
        s = get_sensor()
        if not s: continue
        hum, temp = s['humidity'], s['temperature']

        # v14: Push sensor data to cloud
        try:
            if sync:
                sync.push_sensor(temperature=temp, humidity=hum, battery=s.get('battery'))
        except Exception as e:
            print(f"   ☁️  Cloud sensor sync failed: {e}")

        if GROWTH_PHASE == "colonization":
            print(f"\n📊 SENSOR (colonization) {datetime.now().strftime('%H:%M:%S')} — {temp}°C | {hum}%")
            add_history("MONITOR_ONLY", f"Col: {temp}°C {hum}%", s)
            log({"timestamp":ts(),"temperature":temp,"humidity":hum,"battery":s['battery'],
                "action_executed":"MONITOR_ONLY","check_type":"colonization_sensor_log",
                "recent_history":history_summary()}); continue
        if not AUTOMATIC_MODE: continue
        print(f"\n{'='*60}\n🤖 AUTO CHECK (FRUITING) - {datetime.now().strftime('%H:%M:%S')}\n{'='*60}")
        print(f"📊 {temp}°C | {hum}% | 🔋{s['battery']}%")
        alert, pause = check_failures(hum)
        if pause:
            AUTOMATIC_MODE = False; send_alert(alert)
            log({"timestamp":ts(),"temperature":temp,"humidity":hum,"battery":s['battery'],
                "claude_reasoning":alert,"action_executed":"AUTO_PAUSED","check_type":"equipment_failure",
                "recent_history":history_summary()}); continue
        if hum < EMERGENCY_HUM_LOW or hum > EMERGENCY_HUM_HIGH:
            print("🚨 EMERGENCY!")
            photo, ppath = await capture_photo()
            ctype = "emergency_low" if hum < EMERGENCY_HUM_LOW else "emergency_high"
            comp = get_comparison(GROWTH_PHASE)
            rd = (triple_colonization if GROWTH_PHASE=="colonization" else analyze_fruiting)(s, photo, comp, ctype)
            dec, rsn = rd.get("decision","WAIT").upper(), rd.get("reasoning","")
            if dec == "WAIT": dec = "MIST" if hum<EMERGENCY_HUM_LOW else "FAN"; rsn=f"OVERRIDE emergency {hum}%"
            action, _ = await execute_decision(dec, rsn, s, photo, ppath)
            log({"timestamp":ts(),"temperature":temp,"humidity":hum,"battery":s['battery'],
                "photo_taken":"Yes" if photo else "No","claude_decision":dec,"claude_reasoning":rsn,
                "action_executed":action,"visual_analysis":json.dumps(rd),
                "check_type":ctype,"automatic_mode":"ENABLED","recent_history":history_summary()}); continue
        if hum < TARGET_HUM_MIN:
            print(f"💧 AUTO_MIST ({hum}% < {TARGET_HUM_MIN}%)")
            await humid(DEVICE_DURATION); action=f"AUTO_MIST_{DEVICE_DURATION}s"
            add_history("AUTO_MIST", f"Auto: {hum}% low", s)
        elif hum > TARGET_HUM_MAX:
            if time.time()-last_fan_time < FAN_COOLDOWN:
                secs = int(time.time()-last_fan_time)
                print(f"⏸️ FAN COOLDOWN ({hum}% but fan ran {secs}s ago)")
                action="FAN_COOLDOWN"; add_history("FAN_COOLDOWN",f"Cooldown {secs}s",s)
            else:
                print(f"🌀 AUTO_FAN ({hum}% > {TARGET_HUM_MAX}%)")
                await fan(DEVICE_DURATION); action=f"AUTO_FAN_{DEVICE_DURATION}s"
                add_history("AUTO_FAN",f"Auto: {hum}% high",s)
        else:
            print(f"✅ AUTO_WAIT ({hum}% in range)")
            action="AUTO_WAIT"; add_history("AUTO_WAIT",f"Auto: {hum}% OK",s)
        log({"timestamp":ts(),"temperature":temp,"humidity":hum,"battery":s['battery'],
            "claude_reasoning":"Automatic control","action_executed":action,
            "check_type":"automatic","recent_history":history_summary()})
        print("="*60)

async def task_fresh_air():
    """Runs every 30min in fruiting phase. Fully independent."""
    global last_fan_time
    while True:
        await asyncio.sleep(FRESH_AIR_INTERVAL)
        if GROWTH_PHASE != "fruiting": continue
        if time.time() - last_sensor_ok > 120:
            print("⏸️ FRESH AIR SKIPPED (sensor offline)"); continue
        if time.time() - last_fan_time < FAN_COOLDOWN:
            secs = int(time.time()-last_fan_time)
            print(f"⏸️ FRESH AIR SKIPPED (fan ran {secs}s ago)"); continue
        print(f"🌬️ Fresh air ({FRESH_AIR_DURATION}s)")
        await fan(FRESH_AIR_DURATION)
        s = get_sensor()
        if s:
            log({"timestamp":ts(),"temperature":s['temperature'],"humidity":s['humidity'],
                "battery":s['battery'],"claude_reasoning":"Scheduled fresh air",
                "action_executed":f"FRESH_AIR_{FRESH_AIR_DURATION}s",
                "check_type":"fresh_air_cycle","recent_history":history_summary()})

async def task_photos():
    """Takes a photo every 4 hours for the record."""
    global last_photo_time
    while True:
        await asyncio.sleep(PHOTO_INTERVAL)
        s = get_sensor()
        if not s: print("⚠️ No sensor for photo"); continue
        print("\n📸 PERIODIC PHOTO CAPTURE")
        photo, ppath = await capture_photo()
        if photo:
            last_photo_time = time.time()
            log({"timestamp":ts(),"temperature":s['temperature'],"humidity":s['humidity'],
                "battery":s['battery'],"photo_taken":"Yes","action_executed":"PHOTO_ONLY",
                "check_type":"periodic_photo","photo_path":ppath or "","recent_history":history_summary()})
            print("   ✅ Photo saved")
            # v14: Upload photo to cloud
            try:
                if sync and ppath:
                    sync.push_photo(rgb_path=ppath)
                    print("   ☁️  Photo synced to cloud")
            except Exception as e:
                print(f"   ☁️  Cloud photo sync failed: {e}")
        else: print("   ❌ Photo failed")

async def task_vision():
    """Claude comparative vision — every 6h (fruiting) or 24h (colonization)."""
    global waiting_for_fruiting_confirmation, fruiting_confirmation_requested_at
    global waiting_for_pins, last_fan_time, FRESH_AIR_INTERVAL
    await asyncio.sleep(1)
    while True:
        print(f"\n{'='*60}\n👁️  CLAUDE VISION - {datetime.now().strftime('%H:%M:%S')}\n{'='*60}")
        s = get_sensor()
        if not s: print("⚠️ No sensor"); await asyncio.sleep(300); continue
        print(f"📊 {s['temperature']}°C | {s['humidity']}% | Phase: {GROWTH_PHASE.upper()}")
        photo, ppath = await capture_photo()
        if not photo: print("❌ Photo failed"); await asyncio.sleep(300); continue
        comp = get_comparison(GROWTH_PHASE)
        if GROWTH_PHASE == "colonization":
            rd = triple_colonization(s, photo, comp)
        else:
            rd = analyze_fruiting(s, photo, comp)
        dec, rsn = rd.get("decision","WAIT").upper(), rd.get("reasoning","")
        save_reference(photo, GROWTH_PHASE)

        # v14: Push vision results and decision to cloud
        try:
            if sync:
                # Push the AI decision
                decision_type = "VISION" if GROWTH_PHASE == "colonization" else "HARVEST"
                if rd.get("contamination_detected"):
                    decision_type = "ALERT"
                sync.push_decision(
                    decision_type=decision_type,
                    decision=dec,
                    reasoning=rsn,
                    batch_id=None,  # batch tracking is via cloud UI
                    action_taken=None,  # will be set after execute_decision
                    sensor_context={"temp": s['temperature'], "humidity": s['humidity']},
                    ml_context=rd,
                    cost_kr=0.25,
                )
                # Push vision analysis
                sync.push_vision(batch_id="", analysis=rd)
                # Push photo to cloud
                if ppath:
                    sync.push_photo(rgb_path=ppath, analysis=rd)
                print("   ☁️  Vision synced to cloud")
        except Exception as e:
            print(f"   ☁️  Cloud vision sync failed: {e}")

        # Fully colonized detection
        if GROWTH_PHASE=="colonization" and rd.get('colonization_stage')=='fully_colonized' and not waiting_for_fruiting_confirmation:
            print("🍄 FULLY COLONIZED!")
            send_alert("🍄 FULLY COLONIZED!\n\nReady for fruiting.\n1. Cut the bag\n2. Reply 'fruiting start'")
            waiting_for_fruiting_confirmation = True
            fruiting_confirmation_requested_at = datetime.now()
        # Pin detection
        if GROWTH_PHASE=="fruiting" and waiting_for_pins:
            pins = rd.get('pin_count',0)+rd.get('mushroom_count',0)
            if pins > 0:
                print(f"🍄 PINS DETECTED! {pins}")
                FRESH_AIR_INTERVAL = 1800; waiting_for_pins = False
                send_alert(f"🍄 PINS DETECTED! Count: {pins}\nFresh air → 30min cycles")
        # Display
        if GROWTH_PHASE=="fruiting":
            print(f"🍄 Count:{rd.get('mushroom_count',0)} | Pins:{rd.get('pin_count',0)}")
        else:
            print(f"🧫 Coverage:{rd.get('coverage_percent',0):.0f}% [{rd.get('check1_result','?')}/{rd.get('check2_result','?')}/{rd.get('check3_result','?')}] conf:{rd.get('confidence','?')}")
        print(f"🧠 {dec}: {rsn}")
        action, _ = await execute_decision(dec, rsn, s, photo, ppath)
        log({"timestamp":ts(),"temperature":s['temperature'],"humidity":s['humidity'],"battery":s['battery'],
            "photo_taken":"Yes","claude_decision":dec,"claude_reasoning":rsn,"action_executed":action,
            "photo_path":ppath or "","visual_analysis":json.dumps(rd),
            "check_type":"triple_sampling_vision" if GROWTH_PHASE=="colonization" else "fruiting_vision_check",
            "automatic_mode":"ENABLED" if AUTOMATIC_MODE else "DISABLED","recent_history":history_summary()})
        print("="*60)
        interval = VISION_INTERVAL_COLONIZATION if GROWTH_PHASE=="colonization" else VISION_INTERVAL_FRUITING
        await asyncio.sleep(interval)

# ==================== ENERGY MONITORING (v14) ====================

ENERGY_INTERVAL = 1800  # 30 minutes

async def task_energy_monitor():
    """Reads cumulative kWh from each Tapo P110 plug every 30 min and pushes to cloud."""
    global _tapo_client
    await asyncio.sleep(60)  # Wait for Tapo client to be initialized
    while True:
        try:
            if sync and CLOUD_FARM_ID:
                if _tapo_client is None:
                    _tapo_client = ApiClient(TAPO_EMAIL, TAPO_PASSWORD)
                for ip, device_name in _IP_TO_ENERGY_NAME.items():
                    try:
                        dev = await _tapo_client.p110(ip)
                        usage = await dev.get_energy_usage()
                        today_wh = getattr(usage, 'today_energy', 0) or 0
                        if isinstance(usage, dict):
                            today_wh = usage.get('today_energy', today_wh)
                        today_kwh = today_wh / 1000.0
                        if today_kwh > 0:
                            sync.push_energy(CLOUD_FARM_ID, CLOUD_ZONE_ID or None, device_name, today_kwh)
                            print(f"   ⚡ {device_name}: {today_kwh:.3f} kWh")
                    except Exception as e:
                        print(f"   ⚡ Energy read failed ({device_name}): {e}")
                print(f"⚡ Energy monitor cycle complete — {datetime.now().strftime('%H:%M')}")
        except Exception as e:
            print(f"⚡ Energy monitor error: {e}")
        await asyncio.sleep(ENERGY_INTERVAL)

# ==================== CLOUD COMMANDS (v14) ====================

def handle_cloud_commands():
    """Poll cloud API for pending commands. Handles them the same way as Telegram."""
    global AUTOMATIC_MODE, GROWTH_PHASE, FRESH_AIR_INTERVAL
    global waiting_for_fruiting_confirmation, fruiting_confirmation_requested_at
    global waiting_for_pins, phase_started_at, fruiting_started_at

    if not sync:
        return None

    try:
        commands = sync.poll_commands()
        if not commands:
            return None

        for cmd in commands:
            command = cmd.get("command", "").upper()
            cmd_id = cmd.get("id", "")
            payload = cmd.get("payload") or {}
            result_msg = ""

            if command in ("START_FRUITING", "FRUITING_START"):
                if GROWTH_PHASE == "colonization":
                    GROWTH_PHASE = "fruiting"; save_phase("fruiting")
                    waiting_for_fruiting_confirmation = False; fruiting_confirmation_requested_at = None
                    waiting_for_pins = True; FRESH_AIR_INTERVAL = 1200
                    phase_started_at = fruiting_started_at = datetime.now()
                    send_alert("✅ FRUITING PHASE STARTED (via cloud)!\n\nHumidity 85-90%, fresh air every 20min.")
                    log({"timestamp":ts(),"claude_reasoning":"Cloud command: start fruiting",
                        "action_executed":"PHASE_CHANGE_FRUITING_CLOUD","check_type":"phase_transition",
                        "recent_history":history_summary()})
                    result_msg = "Phase changed to FRUITING. Humidity target 85-90%."
                    print(f"☁️  CLOUD CMD: START_FRUITING → executed")
                else:
                    result_msg = "Already in fruiting phase."
                    print(f"☁️  CLOUD CMD: START_FRUITING → already fruiting")

            elif command == "ENABLE_AUTO":
                if not AUTOMATIC_MODE:
                    AUTOMATIC_MODE = True
                    send_alert("✅ Automatic mode ENABLED (via cloud)")
                    result_msg = "Automatic mode enabled."
                    print(f"☁️  CLOUD CMD: ENABLE_AUTO → enabled")
                else:
                    result_msg = "Already in automatic mode."

            elif command == "DISABLE_AUTO":
                if AUTOMATIC_MODE:
                    AUTOMATIC_MODE = False
                    send_alert("🔴 Automatic mode DISABLED (via cloud)")
                    result_msg = "Automatic mode disabled."
                    print(f"☁️  CLOUD CMD: DISABLE_AUTO → disabled")
                else:
                    result_msg = "Already in manual mode."

            elif command == "FORCE_MIST":
                duration = payload.get("duration_seconds", DEVICE_DURATION)
                # Schedule mist via asyncio (can't await from sync context)
                result_msg = f"Mist command queued ({duration}s)."
                print(f"☁️  CLOUD CMD: FORCE_MIST ({duration}s)")
                # Use fire-and-forget via thread
                threading.Thread(target=lambda d=duration: asyncio.run(humid(d)), daemon=True).start()

            elif command == "FORCE_FAN":
                duration = payload.get("duration_seconds", DEVICE_DURATION)
                result_msg = f"Fan command queued ({duration}s)."
                print(f"☁️  CLOUD CMD: FORCE_FAN ({duration}s)")
                threading.Thread(target=lambda d=duration: asyncio.run(fan(d)), daemon=True).start()

            else:
                result_msg = f"Unknown command: {command}"
                print(f"☁️  CLOUD CMD: {command} → unknown")

            # Acknowledge command
            try:
                status = "EXECUTED" if "queued" not in result_msg and "Unknown" not in result_msg else "EXECUTED"
                if "Unknown" in result_msg:
                    status = "FAILED"
                sync.ack_command(cmd_id, status=status, result=result_msg)
            except Exception as e:
                print(f"   ☁️  Failed to ack command {cmd_id}: {e}")

        return f"Processed {len(commands)} cloud command(s)"

    except Exception as e:
        print(f"   ☁️  Cloud command poll failed: {e}")
        return None

# ==================== TELEGRAM ====================
def check_telegram():
    global AUTOMATIC_MODE, GROWTH_PHASE, FRESH_AIR_INTERVAL
    global waiting_for_fruiting_confirmation, fruiting_confirmation_requested_at
    global waiting_for_pins, phase_started_at, fruiting_started_at, last_telegram_update_id
    try:
        r = requests.get(f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/getUpdates",
            params={"offset":last_telegram_update_id+1,"timeout":5}, timeout=10).json()
        if not r.get("ok") or not r.get("result"): return None
        msgs = r["result"]
        if not msgs: return None
        last_telegram_update_id = max(m["update_id"] for m in msgs)
        for msg in reversed(msgs):
            if "message" not in msg or "text" not in msg["message"]: continue
            if str(msg["message"]["chat"]["id"]) != TELEGRAM_CHAT_ID: continue
            txt = msg["message"]["text"].lower().strip()
            if txt in ("fruiting start","start fruiting","fruiting","begin fruiting"):
                if GROWTH_PHASE == "colonization":
                    GROWTH_PHASE = "fruiting"; save_phase("fruiting")
                    waiting_for_fruiting_confirmation=False; fruiting_confirmation_requested_at=None
                    waiting_for_pins=True; FRESH_AIR_INTERVAL=1200
                    phase_started_at=fruiting_started_at=datetime.now()
                    send_alert("✅ FRUITING PHASE STARTED!\n\nHumidity 85-90%, fresh air every 20min.")
                    log({"timestamp":ts(),"claude_reasoning":"User initiated fruiting",
                        "action_executed":"PHASE_CHANGE_FRUITING_MANUAL","check_type":"phase_transition",
                        "recent_history":history_summary()})
                    return "FRUITING_STARTED"
                else: send_alert("⚠️ Already in fruiting phase."); return None
            if txt in ("fixed","enable","resume") and not AUTOMATIC_MODE:
                AUTOMATIC_MODE=True; send_alert("✅ Automatic mode ENABLED"); return "ENABLED"
            if txt in ("disable","pause") and AUTOMATIC_MODE:
                AUTOMATIC_MODE=False; send_alert("🔴 Automatic mode DISABLED\n\nReply 'enable' to resume."); return "DISABLED"
    except Exception: pass
    return None

def check_fruiting_reminder():
    global last_reminder_sent_at
    if waiting_for_fruiting_confirmation and fruiting_confirmation_requested_at:
        hrs = (datetime.now()-fruiting_confirmation_requested_at).total_seconds()/3600
        should_remind = hrs >= 6 and (last_reminder_sent_at is None or
            (datetime.now()-last_reminder_sent_at).total_seconds() >= 21600)
        if should_remind:
            send_alert(f"⏰ REMINDER: Fruiting pending {int(hrs)}h\n\nReply 'fruiting start'")
            last_reminder_sent_at = datetime.now()

# ==================== WEB DASHBOARD ====================
dash_app = Flask(__name__)

@dash_app.route("/")
def dash_home():
    uptime = time.time() - _start_time if _start_time else 0
    cloud_status = "ON" if sync else "OFF"
    return f"""<!DOCTYPE html><html><head><title>Mushroom Farm</title>
    <meta http-equiv="refresh" content="30">
    <style>body{{font-family:monospace;max-width:800px;margin:40px auto;padding:0 20px;background:#1a1a1a;color:#e0e0e0}}
    h1{{color:#4abe7b}}.ok{{color:#4abe7b}}.err{{color:#d94f4f}}
    .card{{background:#252525;padding:16px;border-radius:8px;margin:8px 0}}img{{max-width:100%;border-radius:8px}}</style></head>
    <body><h1>🍄 Mushroom Farm v14</h1>
    <div class="card"><p>Phase: <b>{GROWTH_PHASE.upper()}</b> | Batch: <b>{BATCH_NUMBER}</b> | Uptime: <b>{int(uptime//3600)}h{int((uptime%3600)//60)}m</b></p>
    <p>Auto: <span class="{'ok' if AUTOMATIC_MODE else 'err'}"><b>{'ON' if AUTOMATIC_MODE else 'OFF'}</b></span> |
    Camera: <span class="{'ok' if camera.running else 'err'}"><b>{'OK' if camera.running else 'ERR'}</b></span> ({camera.frame_count} frames) |
    Cloud: <span class="{'ok' if sync else 'err'}"><b>{cloud_status}</b></span></p></div>
    <div class="card"><a href="/capture/rgb"><img src="/capture/rgb"></a><br><a href="/capture/depth">Depth map</a> | <a href="/stream">Live stream</a></div>
    <div class="card"><pre>{history_summary()}</pre></div></body></html>"""

@dash_app.route("/health")
def dash_health():
    return jsonify(status="ok" if camera.running else "error", phase=GROWTH_PHASE,
                   batch=BATCH_NUMBER, auto=AUTOMATIC_MODE, frames=camera.frame_count,
                   cloud=bool(sync))

@dash_app.route("/capture/rgb")
def dash_rgb():
    c, _ = camera.capture()
    if c is None: return "Failed", 500
    _, buf = cv2.imencode('.jpg', c, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return Response(buf.tobytes(), mimetype='image/jpeg')

@dash_app.route("/capture/depth")
def dash_depth():
    _, d = camera.capture()
    if d is None: return "Failed", 500
    cm = cv2.applyColorMap(cv2.convertScaleAbs(d, alpha=0.03), cv2.COLORMAP_JET)
    _, buf = cv2.imencode('.jpg', cm, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return Response(buf.tobytes(), mimetype='image/jpeg')

@dash_app.route("/stream")
def dash_stream():
    def gen():
        start = time.time()
        while time.time() - start < 300:
            c, _ = camera.capture()
            if c is None: time.sleep(1); continue
            _, buf = cv2.imencode('.jpg', c, [cv2.IMWRITE_JPEG_QUALITY, 60])
            yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n'
            time.sleep(0.5)
    return Response(gen(), mimetype='multipart/x-mixed-replace; boundary=frame')

_start_time = None

# ==================== MAIN ====================
async def main():
    global _start_time
    print(f"\n╔{'='*58}╗")
    print(f"║  🍄 MUSHROOM FARM v14 - Pi + RealSense + Cloud Sync      ║")
    print(f"╚{'='*58}╝\n")
    _start_time = time.time()

    # v14: Initialize cloud sync
    _init_cloud_sync()

    # Start camera
    print("📷 Starting RealSense D435...")
    if not camera.start():
        send_alert("❌ CAMERA OFFLINE\nCheck USB 3.0 (blue port)"); return

    # Start dashboard
    threading.Thread(target=lambda: dash_app.run(host="0.0.0.0", port=5555, threaded=True, use_reloader=False),
                     daemon=True).start()
    print(f"🌐 Dashboard: http://192.168.0.48:5555\n")

    print(f"📊 Phase: {GROWTH_PHASE.upper()} | Sensor: {ESP32_URL}")
    print(f"💧 Durations: device={DEVICE_DURATION}s fresh_air={FRESH_AIR_DURATION}s cooldown={FAN_COOLDOWN}s")
    print(f"📸 Photos: {PHOTO_INTERVAL//3600}h | 👁️ Vision: col={VISION_INTERVAL_COLONIZATION//3600}h fruit={VISION_INTERVAL_FRUITING//3600}h")
    print(f"☁️  Cloud: {'CONNECTED' if sync else 'NOT CONFIGURED'} | Farm: {CLOUD_FARM_ID[:12] + '...' if CLOUD_FARM_ID else 'N/A'}")
    print(f"⚡ Energy: every {ENERGY_INTERVAL//60}min | Plugs: fan={PLUG_FAN_IP} humid={PLUG_HUMID_IP} light={PLUG_LIGHT_IP}\n")
    init_sheets()
    s = get_sensor()
    if s: print(f"✅ ESP32: {s['temperature']}°C {s['humidity']}%\n")
    else: print(f"❌ ESP32 offline\n"); send_alert(f"⚠️ ESP32 OFFLINE at startup")

    # Launch all tasks independently
    tasks = [
        asyncio.create_task(task_sensor_control(),  name="sensor"),
        asyncio.create_task(task_fresh_air(),       name="fresh_air"),
        asyncio.create_task(task_photos(),          name="photos"),
        asyncio.create_task(task_vision(),          name="vision"),
        asyncio.create_task(task_energy_monitor(),  name="energy"),
    ]

    # Main loop: Telegram + cloud commands + reminders
    while True:
        try:
            cmd = check_telegram()
            if cmd: print(f"📱 {cmd}")
            # v14: Poll cloud commands alongside Telegram
            cloud_cmd = handle_cloud_commands()
            if cloud_cmd: print(f"☁️  {cloud_cmd}")
            check_fruiting_reminder()
            await asyncio.sleep(30)
        except KeyboardInterrupt:
            print("\n🛑 STOPPED")
            camera.stop()
            for t in tasks: t.cancel()
            break
        except Exception as e:
            print(f"❌ Main loop error: {e}")
            await asyncio.sleep(30)

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        BATCH_NUMBER = sys.argv[1]
    else:
        input("Press ENTER to start...")
        while True:
            b = input("\n📦 Batch number: ").strip()
            if b: BATCH_NUMBER=b; break
            print("❌ Cannot be empty.")
    print(f"✅ Starting {BATCH_NUMBER}\n")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        camera.stop()
        print("\n🛑 Shutdown complete.")
