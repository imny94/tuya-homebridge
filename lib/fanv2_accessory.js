const BaseAccessory = require('./base_accessory')

let Accessory;
let Service;
let Characteristic;
let UUIDGen;

const DEFAULT_SPEED_COUNT = 3;
const homekitColourTempMin = 153;
const homekitColourTempMax = 500;

class Fanv2Accessory extends BaseAccessory {
  constructor(platform, homebridgeAccessory, deviceConfig) {

    ({ Accessory, Characteristic, Service } = platform.api.hap);
    super(
      platform,
      homebridgeAccessory,
      deviceConfig,
      Accessory.Categories.FAN,
      Service.Fanv2
    );
    this.statusArr = deviceConfig.status ? deviceConfig.status : [];
    this.functionArr = deviceConfig.functions ? deviceConfig.functions : [];
    this.log.log("[%s] statusArr: %s", this.deviceConfig.name, JSON.stringify(this.statusArr))
    this.log.log("[%s] functionArr: %s", this.deviceConfig.name, JSON.stringify(this.functionArr))
    //support fan light
    this.addLightService();
    this.refreshAccessoryServiceIfNeed(this.statusArr, false);
  }

  //addLightService function
  addLightService() {
    this.lightStatus = this.statusArr.find((item, index) => { return (item.code === 'light' || item.code === 'switch_led') && typeof item.value === 'boolean' });
    if (!this.lightStatus) {
      return;
    }
    // Service
    this.lightService = this.homebridgeAccessory.getService(Service.Lightbulb);
    if (this.lightService) {
      this.lightService.setCharacteristic(Characteristic.Name, this.deviceConfig.name + ' Light');
    }
    else {
      // add new service
      this.lightService = this.homebridgeAccessory.addService(Service.Lightbulb, this.deviceConfig.name + ' Light');
    }
  }

  //init Or refresh AccessoryService
  refreshAccessoryServiceIfNeed(statusArr, isRefresh) {
    this.isRefresh = isRefresh
    for (const statusMap of statusArr) {
      if (statusMap.code === 'switch' || statusMap.code === 'fan_switch' || statusMap.code === 'switch_fan') {
        this.switchMap = statusMap
        const hbSwitch = this.tuyaParamToHomeBridge(Characteristic.Active, this.switchMap.value);
        this.normalAsync(Characteristic.Active, hbSwitch)
      }
      if (statusMap.code === 'mode') {
        this.modeMap = statusMap
        const hbFanState = this.tuyaParamToHomeBridge(Characteristic.TargetFanState, this.modeMap.value);
        this.normalAsync(Characteristic.TargetFanState, hbFanState)

      }
      if (statusMap.code === 'child_lock') {
        this.lockMap = statusMap
        const hbLock = this.tuyaParamToHomeBridge(Characteristic.LockPhysicalControls, this.lockMap.value);
        this.normalAsync(Characteristic.LockPhysicalControls, hbLock)
      }

      if (statusMap.code === 'fan_direction') {
        this.directionMap = statusMap
        const hbDirection = this.tuyaParamToHomeBridge(Characteristic.RotationDirection, this.directionMap.value);
        this.normalAsync(Characteristic.RotationDirection, hbDirection)
      }

      if (statusMap.code === 'fan_speed_percent') {
        this.speedMap = statusMap
        this.speed_range = this.getSpeedFunctionRange(this.speedMap.code)
        const rawValue = this.speedMap.value // 1~12
        const value = Math.floor((rawValue * 100 - 100 * this.speed_range.min) / (this.speed_range.max - this.speed_range.min));  // 0-100
        this.normalAsync(Characteristic.RotationSpeed, value)
      }

      if (statusMap.code === 'fan_speed') {
        this.speedMap = statusMap;
        this.log.log("[%s] speedMap: %s", this.deviceConfig.name, JSON.stringify(this.speedMap))
        if ((typeof this.speedMap.value == 'string') && this.speedMap.value.constructor == String) {
          //get speed level dp range
          this.speed_count = this.getSpeedFunctionLevel(this.speedMap.code)
          this.speed_coefficient = 100 / this.speed_count
          const hbSpeed = parseInt(this.speedMap.value * this.speed_coefficient);
          this.normalAsync(Characteristic.RotationSpeed, hbSpeed)
        }else{
          this.speed_range = this.getSpeedFunctionRange(this.speedMap.code)
          this.log.log("[%s] fan_speed Speed range: %s", this.deviceConfig.name, JSON.stringify(this.speed_range))
          const rawValue = this.speedMap.value // 1~12
          const value = Math.floor((rawValue * 100 - 100 * this.speed_range.min) / (this.speed_range.max - this.speed_range.min));  // 0-100
          this.normalAsync(Characteristic.RotationSpeed, value)
        }
      }

      if (statusMap.code === 'switch_vertical') {
        this.swingMap = statusMap
        const hbSwing = this.tuyaParamToHomeBridge(Characteristic.SwingMode, this.swingMap.value);
        this.normalAsync(Characteristic.SwingMode, hbSwing)
      }

      if (this.lightService && (statusMap.code === 'light' || statusMap.code === 'switch_led')) {
        this.switchLed = statusMap;
        const hbLight = this.tuyaParamToHomeBridge(Characteristic.On, this.switchLed.value);
        this.normalAsync(Characteristic.On, hbLight, this.lightService)
      }

      if (this.lightService && statusMap.code === 'bright_value') {
        this.brightValue = statusMap;
        this.bright_range = this.getBrightnessFunctionRange(this.brightValue.code)
        const rawValue = this.brightValue.value;
        const percentage = Math.floor((rawValue - this.bright_range.min) * 100 / (this.bright_range.max - this.bright_range.min)); //    $
        this.normalAsync(Characteristic.Brightness, percentage > 100 ? 100 : percentage, this.lightService)
      }

      if (this.lightService && statusMap.code === 'temp_value') {
        this.tempValue = statusMap;
        this.temperature_range = this.getTemperatureFunctionRange(this.tempValue.code)
        const temperature = this.tempValue.value;
        this.normalAsync(Characteristic.ColorTemperature, temperature, this.lightService)
      }
    }
  }

  normalAsync(name, hbValue, service = null) {
    this.setCachedState(name, hbValue);
    if (this.isRefresh) {
      (service ? service : this.service)
        .getCharacteristic(name)
        .updateValue(hbValue);
    } else {
      this.getAccessoryCharacteristic(name, service);
    }
  }

  getAccessoryCharacteristic(name, service = null) {
    //set  Accessory service Characteristic
    (service ? service : this.service).getCharacteristic(name)
      .on('get', callback => {
        if (this.hasValidCache()) {
          callback(null, this.getCachedState(name));
        }
      }).on('set', (value, callback) => {
        this.log.log("[SET][%s] Received Homebridge callback for Characteristic: %s with Value: %s", this.homebridgeAccessory.displayName, name, value);
        const param = this.getSendParam(name, value)
        this.platform.tuyaOpenApi.sendCommand(this.deviceId, param).then(() => {
          this.setCachedState(name, value);
          callback();
        }).catch((error) => {
          this.log.error('[SET][%s] Characteristic Error: %s', this.homebridgeAccessory.displayName, error);
          this.invalidateCache();
          callback(error);
        });
      });
  }

  getSendParam(name, hbValue) {
    var code;
    var value;
    switch (name) {
      case Characteristic.Active:
        value = hbValue == 1 ? true : false;
        const isOn = value;
        code = this.switchMap.code;
        value = isOn;
        break;
      case Characteristic.TargetFanState:
        value = hbValue == 1 ? "smart" : "nature";
        const mode = value;
        code = "mode";
        value = mode;
        break;
      case Characteristic.LockPhysicalControls:
        value = hbValue == 1 ? true : false;
        const isLock = value;
        code = "child_lock";
        value = isLock;
        break;
      case Characteristic.RotationDirection:
        value = hbValue == 0 ? "forward" : "reverse";
        const direction = value;
        code = "fan_direction";
        value = direction;
        break;
      case Characteristic.RotationSpeed:
        let speed
        if ((typeof this.speedMap.value == 'string') && this.speedMap.value.constructor == String) {
          let level = Math.floor(hbValue / this.speed_coefficient) + 1
          level = level > this.speed_count ? this.speed_count : level;
          speed = "" + level;
        }else{
          // speed = Math.floor((hbValue * this.speed_range.max - hbValue * this.speed_range.min + 100 * this.speed_range.min) / 100);  //1~100
          speed = Math.floor((this.speed_range.max - this.speed_range.min) * hbValue / 100) + this.speed_range.min
          this.log.log("[%s] Mapped speed from hbValue: %s to value: %s. min: %s max: %s", this.deviceConfig.name, hbValue, speed, this.speed_range.min, this.speed_range.max);
        }
        code = this.speedMap.code;
        value = speed;
        break;
      case Characteristic.SwingMode:
        value = hbValue == 1 ? true : false;
        const isSwing = value;
        code = "switch_vertical";
        value = isSwing;
        break;
      case Characteristic.On:
        code = this.switchLed.code;
        value = hbValue == 1 ? true : false;
        break;
      case Characteristic.Brightness:
        value = Math.floor((this.bright_range.max - this.bright_range.min) * hbValue / 100 + this.bright_range.min); //  value 0~100
        code = this.brightValue.code;
        break;
      case Characteristic.ColorTemperature:
        code = this.tempValue.code;
        // HomeKit uses Mireds (153-500) → Kelvin = 1,000,000 / Mireds
        const {min: currMin, max: currMax} = this.temperature_range;
        // value = Math.round(currMin + ((homekitColourTempMax - this.tempValue.value) / (homekitColourTempMax - homekitColourTempMin)) * (currMax - currMin));
        value = Math.round(homekitColourTempMax - ((this.tempValue.value - homekitColourTempMin) / (currMax - currMin)) * (homekitColourTempMax - homekitColourTempMin));
        break;
      default:
        break;
    }
    return {
      "commands": [
        {
          "code": code,
          "value": value
        }
      ]
    };
  }


  tuyaParamToHomeBridge(name, param) {
    switch (name) {
      case Characteristic.On:
      case Characteristic.Active:
      case Characteristic.LockPhysicalControls:
      case Characteristic.SwingMode:
        let status
        if (param) {
          status = 1
        } else {
          status = 0
        }
        return status
      case Characteristic.TargetFanState:
        let value
        if (param === 'smart') {
          value = 1
        } else {
          value = 0
        }
        return value
      case Characteristic.RotationDirection:
        let direction
        if (param === "forward") {
          direction = 0
        } else {
          direction = 1
        }
        return direction
    }
  }

  getSpeedFunctionRange(code) {
    if (this.functionArr.length == 0) {
      this.log.log("[%s] getSpeedFunctionRange code: %s functionArr: %s is empty setting min max to default of 0 and 100 respectively", this.deviceConfig.name, this.functionArr, code)
      return { 'min': 1, 'max': 100 };
    }
    var funcDic = this.functionArr.find((item, index) => { return item.code == code })
    this.log.log("[%s] getSpeedFunctionRange code: %s funcDic: %s", this.deviceConfig.name, code, JSON.stringify(funcDic))
    if (funcDic) {
      let valueRange = JSON.parse(funcDic.values)
      let isnull = (JSON.stringify(valueRange) == "{}")
      return isnull ? { 'min': 1, 'max': 100 } : { 'min': parseInt(valueRange.min), 'max': parseInt(valueRange.max) };
    } else {
      return { 'min': 1, 'max': 100 };
    }
  }

  getSpeedFunctionLevel(code) {
    if (this.functionArr.length == 0) {
      return DEFAULT_SPEED_COUNT;
    }
    var funcDic = this.functionArr.find((item, index) => { return item.code == code })
    this.log.log("getSpeedFunctionLevel code: %s funcDic: %s", code, JSON.stringify(funcDic))
    if (funcDic) {
      let value = JSON.parse(funcDic.values)
      let isnull = (JSON.stringify(value) == "{}")
      return isnull || !value.range ? DEFAULT_SPEED_COUNT : value.range.length;
    } else {
      return DEFAULT_SPEED_COUNT;
    }
  }

  getBrightnessFunctionRange(code) {
    if (this.functionArr.length == 0) {
      return { 'min': 10, 'max': 1000 };
    }
    var funcDic = this.functionArr.find((item, index) => { return item.code === code })
    if (funcDic) {
      let valueRange = JSON.parse(funcDic.values)
      let isnull = (JSON.stringify(valueRange) == "{}")
      return isnull ? { 'min': 10, 'max': 1000 } : { 'min': parseInt(valueRange.min), 'max': parseInt(valueRange.max) };
    } else {
      return { 'min': 10, 'max': 1000 }
    }
  }

  getTemperatureFunctionRange(code) {
    const funcDic = this.functionArr.find((item, index) => { return item.code === code })
    // HomeKit uses Mireds (153-500) → Kelvin = 1,000,000 / Mireds
    const defaultRange = { 'min': homekitColourTempMin, 'max': homekitColourTempMax };
    if (this.functionArr.length === 0 || !funcDic) {
      return defaultRange;
    }
    const valueRange = JSON.parse(funcDic.values)
    return valueRange ?? defaultRange;
  }

  //update device status
  updateState(data) {
    this.refreshAccessoryServiceIfNeed(data.status, true);
  }
}

module.exports = Fanv2Accessory;
