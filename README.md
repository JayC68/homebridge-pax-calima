# homebridge-pax-calima

Homebridge platform plugin for **Pax Calima** and **Vent-Axia Svara** Bluetooth LE bathroom extractor fans.

The Vent-Axia Svara is the UK rebrand of the Pax Calima — they use the **exact same Bluetooth protocol**, MAC prefix (`58:2b:db`), and GATT characteristics.

## Features
- Automatic discovery of fans (MAC starting with `58:2b:db`)
- Fan control (On/Off + Rotation Speed 0-100%)
- Live sensors: Humidity, Temperature, Light level
- Mode switching (Multi Mode, Heat Distribution)
- Boost button (press to activate temporary high-speed boost)
- Silent Hours toggle
- Automatic cycle switches (30/60/90 min)
- Trickle ventilation toggle
- Easy configuration via Homebridge Config UI

Perfect for Apple Home automations.

## Installation

### Via Homebridge UI (recommended)
Search for **Pax Calima** or **Svara** and install.

### Via Terminal
```bash
npm install -g homebridge-pax-calima
