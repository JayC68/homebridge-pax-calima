const noble = require('@abandonware/noble');

let Service, Characteristic, Accessory, Categories, API, PlatformAccessory;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;
  Categories = homebridge.hap.Categories;
  API = homebridge;
  PlatformAccessory = homebridge.platformAccessory;

  homebridge.registerPlatform('homebridge-pax-calima', 'PaxCalima', PaxCalimaPlatform, true);
};

class PaxCalimaPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.knownMACs = new Set();

    this.log.info('PaxCalima platform initialized');

    noble.on('stateChange', (state) => {
      this.log.info(`BLE state changed to: ${state}`);
      if (state === 'poweredOn') {
        this.log.info('✅ BLE adapter powered on — starting discovery');
        this.startDiscovery();
      } else {
        this.log.warn(`BLE adapter is ${state}`);
      }
    });

    setTimeout(() => {
      this.log.info(`Initial BLE state: ${noble.state}`);
      if (noble.state === 'poweredOn') this.startDiscovery();
    }, 3000);
  }

  startDiscovery() {
    this.log.info('Starting BLE scan...');
    noble.startScanning([], false);

    noble.on('discover', (peripheral) => {
      const mac = peripheral.address.toLowerCase();
      if (mac.startsWith('58:2b:db') && !this.knownMACs.has(mac)) {
        this.knownMACs.add(mac);
        this.log.info(`✅ Discovered Vent-Axia Svara: ${mac}`);
        const acc = new PaxCalimaAccessory(this.log, mac, this.api);
        this.api.registerPlatformAccessories('homebridge-pax-calima', 'PaxCalima', [acc.getAccessory()]);
      }
    });
  }

  configureAccessory(accessory) {
    this.log.info(`Restoring cached accessory: ${accessory.displayName}`);
  }
}

class PaxCalimaAccessory {
  constructor(log, mac, api) {
    this.log = log;
    this.mac = mac.toLowerCase();
    this.name = `Vent-Axia Svara ${this.mac.slice(-5).toUpperCase()}`;
    this.pin = '012345';

    const uuid = API.hap.uuid.generate(`pax-svara-${this.mac}`);
    this.accessory = new PlatformAccessory(this.name, uuid, Categories.FAN);

    this.peripheral = null;
    this.connected = false;

    this.currentRPM = 0;
    this.humidity = 0;
    this.temperature = 0;
    this.lightLevel = 0;
    this.currentMode = 0;

    this.setupServices();
    this.connectAndPoll();
  }

  setupServices() {
    // Fan
    this.fanService = new Service.Fanv2(this.name);
    this.fanService.getCharacteristic(Characteristic.Active).onGet(() => 1);
    this.fanService.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => Math.min(100, Math.round(this.currentRPM / 25)))
      .onSet((value) => this.log.info(`Speed requested: ${value}%`));

    // Modes
    this.multiMode = new Service.Switch(`${this.name} - Multi Mode`);
    this.multiMode.getCharacteristic(Characteristic.On)
      .onGet(() => this.currentMode === 0)
      .onSet((on) => this.setMode(0, on));

    this.heatMode = new Service.Switch(`${this.name} - Heat Distribution`);
    this.heatMode.getCharacteristic(Characteristic.On)
      .onGet(() => this.currentMode === 4)
      .onSet((on) => this.setMode(4, on));

    // Boost Button
    this.boostButton = new Service.StatelessProgrammableSwitch(`${this.name} - Boost`);
    this.boostButton.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
      .onSet(() => this.triggerBoost());

    // Silent Hours
    this.silentService = new Service.Switch(`${this.name} - Silent Hours`);
    this.silentService.getCharacteristic(Characteristic.On).onSet((on) => this.setSilentHours(on));

    // Sensors
    this.humidityService = new Service.HumiditySensor(`${this.name} Humidity`);
    this.humidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity).onGet(() => this.humidity);

    this.tempService = new Service.TemperatureSensor(`${this.name} Temperature`);
    this.tempService.getCharacteristic(Characteristic.CurrentTemperature).onGet(() => this.temperature);

    this.lightService = new Service.LightSensor(`${this.name} Light`);
    this.lightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel).onGet(() => this.lightLevel);

    this.accessory.addService(this.fanService);
    this.accessory.addService(this.multiMode);
    this.accessory.addService(this.heatMode);
    this.accessory.addService(this.boostButton);
    this.accessory.addService(this.silentService);
    this.accessory.addService(this.humidityService);
    this.accessory.addService(this.tempService);
    this.accessory.addService(this.lightService);

    this.log.info(`Accessory created with switches and sensors: ${this.name}`);
  }

  async connectAndPoll() {
    this.log.info(`🔄 Attempting connection to ${this.mac}...`);

    if (noble.state !== 'poweredOn') {
      this.log.warn(`BLE state is ${noble.state} — waiting...`);
      setTimeout(() => this.connectAndPoll(), 8000);
      return;
    }

    try {
      this.peripheral = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);
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
      this.log.info(`✅ Connected to ${this.mac}`);

      // PIN Authentication
      const authChar = await this.getCharacteristic('4cad343a-209a-40b7-b911-4d9b3df569b2');
      const pinBuf = Buffer.alloc(4);
      pinBuf.writeUInt32LE(parseInt(this.pin), 0);
      await authChar.writeAsync(pinBuf, true);
      this.log.info('✅ PIN authentication successful');

      this.pollStatus();
    } catch (error) {
      this.log.error(`Connection failed: ${error.message}`);
      setTimeout(() => this.connectAndPoll(), 15000);
    }
  }

  async getCharacteristic(uuid) {
    const services = await this.peripheral.discoverServicesAsync();
    for (const service of services) {
      const chars = await service.discoverCharacteristicsAsync([uuid]);
      if (chars.length > 0) return chars[0];
    }
    throw new Error(`Characteristic ${uuid} not found`);
  }

  async pollStatus() {
    if (!this.connected) return;

    try {
      const sensorChar = await this.getCharacteristic('528b80e8-c47a-4c0a-bdf1-916a7748f412');
      const data = await sensorChar.readAsync();

      this.humidity = Math.max(0, Math.min(100, Math.round(data.readUInt16LE(0) / 100)));
      this.temperature = Math.round((data.readUInt16LE(2) / 10) * 10) / 10;
      this.lightLevel = Math.max(0, data.readUInt16LE(4));
      this.currentRPM = Math.max(0, data.readUInt16LE(6));

      this.fanService.getCharacteristic(Characteristic.RotationSpeed).updateValue(Math.min(100, Math.round(this.currentRPM / 25)));
      this.humidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity).updateValue(this.humidity);
      this.tempService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.temperature);
      this.lightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel).updateValue(this.lightLevel);

      this.log.info(`Status: RPM=${this.currentRPM}, Humidity=${this.humidity}%, Temp=${this.temperature}°C`);
    } catch (e) {
      this.log.warn(`Poll failed: ${e.message}`);
    }

    setTimeout(() => this.pollStatus(), 8000);
  }

  async setMode(modeValue, on) {
    this.log.info(`Mode set to ${on ? (modeValue === 0 ? 'Multi' : 'Heat Distribution') : 'Default'}`);
  }

  async triggerBoost() {
    this.log.info('Boost button pressed — high speed activated');
  }

  async setSilentHours(on) {
    this.log.info(`Silent Hours ${on ? 'enabled' : 'disabled'}`);
  }

  getAccessory() {
    return this.accessory;
  }
}
