const noble = require('@abandonware/noble');

let Service, Characteristic, Accessory, Categories, API, PlatformAccessory;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;
  Categories = homebridge.hap.Categories;
  API = homebridge;
  PlatformAccessory = homebridge.platformAccessory;   // Important for child bridges

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

    // Force check
    setTimeout(() => {
      this.log.info(`Initial BLE state check: ${noble.state}`);
      if (noble.state === 'poweredOn') this.startDiscovery();
    }, 4000);
  }

  startDiscovery() {
    this.log.info('Starting BLE scan for Pax Calima / Vent-Axia Svara...');
    noble.startScanning([], false);

    noble.on('discover', (peripheral) => {
      const mac = peripheral.address.toLowerCase();
      if (mac.startsWith('58:2b:db') && !this.knownMACs.has(mac)) {
        this.knownMACs.add(mac);
        this.log.info(`✅ Discovered Vent-Axia Svara: ${mac}`);
        const accessory = new PaxCalimaAccessory(this.log, mac, this.api);
        this.api.registerPlatformAccessories('homebridge-pax-calima', 'PaxCalima', [accessory.getAccessory()]);
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
    this.accessory = new PlatformAccessory(this.name, uuid, Categories.FAN);   // Fixed registration

    this.setupServices();
    this.connectAndPoll();
  }

  setupServices() {
    this.fanService = new Service.Fanv2(this.name);
    this.fanService.getCharacteristic(Characteristic.Active).onGet(() => 1);

    this.fanService.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => 0)
      .onSet((value) => this.log.info(`Speed requested: ${value}%`));

    this.accessory.addService(this.fanService);
    this.log.info(`Accessory created: ${this.name} (${this.mac})`);
  }

  async connectAndPoll() {
    this.log.info(`🔄 Attempting connection to ${this.mac}...`);

    if (noble.state !== 'poweredOn') {
      this.log.warn(`BLE state is ${noble.state} - waiting...`);
      setTimeout(() => this.connectAndPoll(), 8000);
      return;
    }

    this.log.info(`BLE ready - attempting to connect to fan...`);
    // Connection logic will be expanded once adapter is recognized
  }

  getAccessory() {
    return this.accessory;
  }
}
