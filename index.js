const noble = require('@abandonware/noble');

let Service, Characteristic, Accessory, Categories, API;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;
  Categories = homebridge.hap.Categories;
  API = homebridge;

  homebridge.registerPlatform('homebridge-pax-calima', 'PaxCalima', PaxCalimaPlatform, true); // dynamic platform for auto-discovery
};

class PaxCalimaPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessories = new Map();
    this.knownMACs = new Set();

    noble.on('stateChange', (state) => {
      if (state === 'poweredOn') {
        this.log.info('BLE ready — scanning for Pax Calima / Vent-Axia Svara fans...');
        this.startDiscovery();
      } else {
        this.log.warn(`BLE state changed to ${state}`);
      }
    });
  }

  startDiscovery() {
    noble.startScanning([], false);
    noble.on('discover', (peripheral) => {
      const mac = peripheral.address.toLowerCase();
      if (mac.startsWith('58:2b:db') && !this.knownMACs.has(mac)) {
        this.knownMACs.add(mac);
        this.log.info(`Discovered Pax Calima / Vent-Axia Svara: ${mac}`);
        const acc = new PaxCalimaAccessory(this.log, mac, this.api);
        this.api.registerPlatformAccessories('homebridge-pax-calima', 'PaxCalima', [acc.getAccessory()]);
      }
    });
  }

  configureAccessory(accessory) {
    this.log.info(`Restoring cached accessory: ${accessory.displayName}`);
    this.accessories.set(accessory.UUID, accessory);
  }
}

class PaxCalimaAccessory {
  constructor(log, mac, api) {
    this.log = log;
    this.mac = mac.toLowerCase();
    this.name = `Bathroom Fan ${this.mac.slice(-5).toUpperCase()}`;
    this.pin = '012345'; // override in config.schema if needed

    // Correct UUID generation for modern Homebridge / HAP-NodeJS
const uuid = API.hap.uuid.generate(`pax-svara-${this.mac}`);
this.accessory = new Accessory(this.name, uuid);
this.accessory.category = Categories.FAN;

    this.peripheral = null;
    this.connected = false;

    // Live state
    this.currentRPM = 0;
    this.humidity = 0;
    this.temperature = 0;
    this.lightLevel = 0;
    this.currentMode = 0;

    this.setupServices();
    this.connectAndPoll();
  }

  setupServices() {
    // Main Fan Service
    this.fanService = new Service.Fanv2(this.name);
    this.fanService.getCharacteristic(Characteristic.Active)
      .onGet(() => 1)
      .onSet((value, cb) => { this.log.info(`Fan active set to ${value}`); cb(null); });

    this.fanService.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(this.getRotationSpeed.bind(this))
      .onSet(this.setRotationSpeed.bind(this));

    // Mode Switches
    this.multiMode = new Service.Switch(`${this.name} - Multi Mode`, 'multi-mode');
    this.multiMode.getCharacteristic(Characteristic.On)
      .onGet(() => this.currentMode === 0)
      .onSet((on, cb) => this.setMode(0, on, cb));

    this.heatMode = new Service.Switch(`${this.name} - Heat Distribution`, 'heat-mode');
    this.heatMode.getCharacteristic(Characteristic.On)
      .onGet(() => this.currentMode === 4)
      .onSet((on, cb) => this.setMode(4, on, cb));

    // Boost Button (Stateless Programmable Switch - ideal for automations)
    this.boostButton = new Service.StatelessProgrammableSwitch(`${this.name} - Boost`, 'boost');
    this.boostButton.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
      .onSet(this.triggerBoost.bind(this));

    // Silent Hours Toggle
    this.silentService = new Service.Switch(`${this.name} - Silent Hours`, 'silent');
    this.silentService.getCharacteristic(Characteristic.On)
      .onGet(() => false) // read-back not implemented yet
      .onSet(this.setSilentHours.bind(this));

    // Automatic Cycles
    this.cycle30 = new Service.Switch(`${this.name} - 30min Cycles`, 'cycle30');
    this.cycle30.getCharacteristic(Characteristic.On).onSet((on, cb) => this.setCycles(on ? 1 : 0, cb));

    this.cycle60 = new Service.Switch(`${this.name} - 60min Cycles`, 'cycle60');
    this.cycle60.getCharacteristic(Characteristic.On).onSet((on, cb) => this.setCycles(on ? 2 : 0, cb));

    this.cycle90 = new Service.Switch(`${this.name} - 90min Cycles`, 'cycle90');
    this.cycle90.getCharacteristic(Characteristic.On).onSet((on, cb) => this.setCycles(on ? 3 : 0, cb));

    // Trickle Toggle
    this.trickleService = new Service.Switch(`${this.name} - Trickle`, 'trickle');
    this.trickleService.getCharacteristic(Characteristic.On).onSet(this.setTrickle.bind(this));

    // Sensors
    this.humidityService = new Service.HumiditySensor(`${this.name} Humidity`);
    this.humidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity).onGet(() => this.humidity);

    this.tempService = new Service.TemperatureSensor(`${this.name} Temperature`);
    this.tempService.getCharacteristic(Characteristic.CurrentTemperature).onGet(() => this.temperature);

    this.lightService = new Service.LightSensor(`${this.name} Light`);
    this.lightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel).onGet(() => this.lightLevel);

    // Add all services to the accessory
    const services = [
      this.fanService, this.multiMode, this.heatMode, this.boostButton, this.silentService,
      this.cycle30, this.cycle60, this.cycle90, this.trickleService,
      this.humidityService, this.tempService, this.lightService
    ];
    services.forEach(s => this.accessory.addService(s));
  }

  async connectAndPoll() {
    try {
      if (!noble.isPoweredOn) {
        this.log.warn('BLE adapter not powered on yet. Retrying...');
        setTimeout(() => this.connectAndPoll(), 5000);
        return;
      }

      this.log.info(`Connecting to fan ${this.mac}...`);

      // Discover the peripheral
      this.peripheral = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Discovery timeout')), 20000);
        noble.startScanning([], false);
        noble.on('discover', (periph) => {
          if (periph.address.toLowerCase() === this.mac) {
            clearTimeout(timeout);
            noble.stopScanning();
            resolve(periph);
          }
        });
      });

      await this.peripheral.connectAsync();
      this.connected = true;
      this.log.info(`Connected to ${this.mac}`);

      // Authentication with PIN
      const authChar = await this.getCharacteristic('4cad343a-209a-40b7-b911-4d9b3df569b2');
      const pinBuf = Buffer.alloc(4);
      pinBuf.writeUInt32LE(parseInt(this.pin), 0);
      await authChar.writeAsync(pinBuf, true);
      this.log.info('PIN authentication successful');

      this.pollStatus();
    } catch (error) {
      this.log.error(`Failed to connect to ${this.mac}: ${error.message}`);
      this.connected = false;
      setTimeout(() => this.connectAndPoll(), 30000); // retry after 30 seconds
    }
  }

  async getCharacteristic(uuid) {
    const services = await this.peripheral.discoverServicesAsync();
    for (const service of services) {
      const chars = await service.discoverCharacteristicsAsync([uuid]);
      if (chars.length > 0) return chars[0];
    }
    throw new Error(`Characteristic ${uuid} not found on device`);
  }

  async pollStatus() {
    if (!this.connected || !this.peripheral) return;

    try {
      const sensorChar = await this.getCharacteristic('528b80e8-c47a-4c0a-bdf1-916a7748f412');
      const data = await sensorChar.readAsync();

      // Basic parsing (adjust based on real testing - values are approximate from pycalima style)
      this.humidity = Math.max(0, Math.min(100, Math.round(data.readUInt16LE(0) / 100)));
      this.temperature = Math.round((data.readUInt16LE(2) / 10) * 10) / 10;
      this.lightLevel = Math.max(0, data.readUInt16LE(4));
      this.currentRPM = Math.max(0, data.readUInt16LE(6));

      // Update HomeKit characteristics
      this.fanService.getCharacteristic(Characteristic.RotationSpeed).updateValue(Math.min(100, Math.round(this.currentRPM / 25)));
      this.humidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity).updateValue(this.humidity);
      this.tempService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.temperature);
      this.lightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel).updateValue(this.lightLevel);

      this.log.debug(`Poll: RPM=${this.currentRPM}, Humidity=${this.humidity}%, Temp=${this.temperature}°C, Light=${this.lightLevel}`);
    } catch (e) {
      this.log.warn(`Status poll failed for ${this.mac}: ${e.message}`);
      this.connected = false;
      this.connectAndPoll();
    }

    setTimeout(() => this.pollStatus(), 8000); // poll every 8 seconds
  }

  getRotationSpeed(callback) {
    callback(null, Math.min(100, Math.round(this.currentRPM / 25)));
  }

  async setRotationSpeed(value, callback) {
    this.log.info(`Requested rotation speed: ${value}% (${Math.round(value * 25)} RPM)`);
    // TODO: Implement write to boost/manual characteristic if needed
    callback(null);
  }

  async setMode(modeValue, on, callback) {
    this.currentMode = on ? modeValue : 0;
    this.log.info(`Mode changed to ${on ? (modeValue === 0 ? 'Multi Mode' : 'Heat Distribution') : 'Default'}`);
    // TODO: Write to mode UUID '90cabcd1-bcda-4167-85d8-16dcd8ab6a6b'
    callback(null);
  }

  async triggerBoost(value, callback) {
    this.log.info('Boost button pressed - activating high speed for 15 minutes');
    // TODO: Write to manual fan control UUID '118c949c-28c8-4139-b0b3-36657fd055a9' with on=1, speed~2000, duration=900
    callback(null);
  }

  async setSilentHours(on, callback) {
    this.log.info(`Silent Hours ${on ? 'enabled (example 22:00-07:00)' : 'disabled'}`);
    // TODO: Write to silent hours UUID 'b5836b55-57bd-433e-8480-46e4993c5ac0'
    callback(null);
  }

  async setCycles(value, callback) {
    this.log.info(`Automatic cycles set to ${value} (0=off, 1=30min, 2=60min, 3=90min)`);
    // TODO: Write to cycles UUID 'f508408a-508b-41c6-aa57-61d1fd0d5c39'
    callback(null);
  }

  async setTrickle(on, callback) {
    this.log.info(`Trickle ventilation ${on ? 'enabled' : 'disabled'}`);
    callback(null);
  }

  getAccessory() {
    return this.accessory;
  }
}
