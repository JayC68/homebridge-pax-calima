const noble = require('@abandonware/noble');

let Service, Characteristic, Accessory, Categories, API;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;
  Categories = homebridge.hap.Categories;
  API = homebridge;

  homebridge.registerPlatform('homebridge-pax-calima', 'PaxCalima', PaxCalimaPlatform, true); // dynamic platform
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
        this.log.info(`Discovered fan: ${mac} (Pax Calima / Vent-Axia Svara)`);
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
    this.pin = '012345'; // override via config if needed

    this.accessory = new Accessory(this.name, Accessory.generateUUID(`pax-svara-${this.mac}`));
    this.accessory.category = Categories.FAN;

    this.setupServices();
    // connectAndPoll() will be fully implemented in the next iteration
    // this.connectAndPoll();
  }

  setupServices() {
    // Basic Fan service (expand with modes, boost, sensors, etc. in next step)
    this.fanService = new Service.Fanv2(this.name);
    this.fanService.getCharacteristic(Characteristic.Active).onGet(() => 1);
    this.fanService.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => 50) // placeholder
      .onSet((value) => this.log.info(`Requested speed: ${value}%`));

    this.accessory.addService(this.fanService);
    // More services (modes, boost button, silent hours, sensors...) will be added next
  }

  getAccessory() {
    return this.accessory;
  }
}
