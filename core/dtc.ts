import type { EcuMessage } from './parse.ts';

/** Two bytes to "P0420": the top two bits pick the system letter, the rest are hex digits. */
export function decodeDtc(hi: number, lo: number): string {
  const letter = 'PCBU'[hi >> 6];
  const d1 = (hi >> 4) & 0x03;
  const d2 = hi & 0x0f;
  return `${letter}${d1}${d2.toString(16).toUpperCase()}${lo.toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * Codes from a service 03 / 07 / 0A reply. On CAN the reply is [43, count, hi, lo, ...]; older
 * protocols send [43, hi, lo, hi, lo, hi, lo] per message with zero padding.
 */
export function parseDtcReply(msg: EcuMessage, isCan: boolean): string[] {
  const body = msg.data.slice(isCan ? 2 : 1);
  const codes: string[] = [];
  for (let i = 0; i + 1 < body.length; i += 2) {
    if (body[i] === 0 && body[i + 1] === 0) continue;
    codes.push(decodeDtc(body[i], body[i + 1]));
  }
  return codes;
}

export const DTC_SYSTEMS: Record<string, string> = {
  P: 'Powertrain',
  C: 'Chassis',
  B: 'Body',
  U: 'Network',
};

/** P1xxx, C1xxx, B1xxx, U1xxx (and P3000-P33FF) are defined by the carmaker, not the standard. */
export function isManufacturerCode(code: string): boolean {
  return code[1] === '1' || (code[0] === 'P' && code[1] === '3' && '0123'.includes(code[2]));
}

/**
 * Plain-English names for common generic codes. Not exhaustive: the app links to a web search for
 * anything missing, and carmaker-specific codes need the maker's documentation.
 */
export const DTC_NAMES: Record<string, string> = {
  P0011: 'Intake camshaft timing over-advanced, bank 1',
  P0014: 'Exhaust camshaft timing over-advanced, bank 1',
  P0016: 'Crankshaft and camshaft positions don’t agree, bank 1',
  P0021: 'Intake camshaft timing over-advanced, bank 2',
  P0030: 'Oxygen sensor heater control circuit, bank 1 sensor 1',
  P0087: 'Fuel rail pressure too low',
  P0100: 'Mass airflow sensor circuit',
  P0101: 'Mass airflow sensor range or performance',
  P0102: 'Mass airflow sensor circuit low',
  P0103: 'Mass airflow sensor circuit high',
  P0110: 'Intake air temperature sensor circuit',
  P0113: 'Intake air temperature sensor circuit high',
  P0115: 'Coolant temperature sensor circuit',
  P0117: 'Coolant temperature sensor circuit low',
  P0118: 'Coolant temperature sensor circuit high',
  P0121: 'Throttle position sensor A range or performance',
  P0122: 'Throttle position sensor A circuit low',
  P0123: 'Throttle position sensor A circuit high',
  P0128: 'Coolant below thermostat regulating temperature',
  P0130: 'Oxygen sensor circuit, bank 1 sensor 1',
  P0133: 'Oxygen sensor slow response, bank 1 sensor 1',
  P0135: 'Oxygen sensor heater circuit, bank 1 sensor 1',
  P0141: 'Oxygen sensor heater circuit, bank 1 sensor 2',
  P0155: 'Oxygen sensor heater circuit, bank 2 sensor 1',
  P0171: 'System too lean, bank 1',
  P0172: 'System too rich, bank 1',
  P0174: 'System too lean, bank 2',
  P0175: 'System too rich, bank 2',
  P0217: 'Engine over-temperature',
  P0300: 'Random or multiple cylinder misfire',
  P0301: 'Cylinder 1 misfire',
  P0302: 'Cylinder 2 misfire',
  P0303: 'Cylinder 3 misfire',
  P0304: 'Cylinder 4 misfire',
  P0305: 'Cylinder 5 misfire',
  P0306: 'Cylinder 6 misfire',
  P0325: 'Knock sensor 1 circuit, bank 1',
  P0335: 'Crankshaft position sensor A circuit',
  P0340: 'Camshaft position sensor A circuit, bank 1',
  P0351: 'Ignition coil A circuit',
  P0352: 'Ignition coil B circuit',
  P0353: 'Ignition coil C circuit',
  P0354: 'Ignition coil D circuit',
  P0355: 'Ignition coil E circuit',
  P0356: 'Ignition coil F circuit',
  P0400: 'EGR flow',
  P0401: 'EGR flow insufficient',
  P0411: 'Secondary air injection incorrect flow',
  P0420: 'Catalyst efficiency below threshold, bank 1',
  P0430: 'Catalyst efficiency below threshold, bank 2',
  P0440: 'Evaporative emission system',
  P0441: 'Evaporative emission system incorrect purge flow',
  P0442: 'Evaporative emission system small leak',
  P0446: 'Evaporative emission vent control circuit',
  P0455: 'Evaporative emission system large leak (check the gas cap)',
  P0456: 'Evaporative emission system very small leak',
  P0460: 'Fuel level sensor circuit',
  P0500: 'Vehicle speed sensor',
  P0505: 'Idle air control system',
  P0506: 'Idle speed lower than expected',
  P0507: 'Idle speed higher than expected',
  P0562: 'System voltage low',
  P0563: 'System voltage high',
  P0600: 'Control module communication link',
  P0605: 'Control module memory (ROM) error',
  P0606: 'Control module processor',
  P0700: 'Transmission control system (the transmission module has its own code)',
  P0705: 'Transmission range sensor circuit',
  P0710: 'Transmission fluid temperature sensor circuit',
  P0715: 'Transmission input or turbine speed sensor circuit',
  P0720: 'Transmission output speed sensor circuit',
  P0725: 'Engine speed input to transmission',
  P0730: 'Incorrect gear ratio',
  P0731: 'Gear 1 incorrect ratio',
  P0732: 'Gear 2 incorrect ratio',
  P0733: 'Gear 3 incorrect ratio',
  P0734: 'Gear 4 incorrect ratio',
  P0735: 'Gear 5 incorrect ratio',
  P0740: 'Torque converter clutch circuit',
  P0741: 'Torque converter clutch performance or stuck off',
  P0744: 'Torque converter clutch circuit intermittent',
  P0750: 'Shift solenoid A',
  P0755: 'Shift solenoid B',
  P0760: 'Shift solenoid C',
  P0765: 'Shift solenoid D',
  P0776: 'Pressure control solenoid B performance or stuck off',
  P0841: 'Transmission fluid pressure sensor A range or performance',
  P0868: 'Transmission fluid pressure low',
  U0100: 'Lost communication with engine computer',
  U0101: 'Lost communication with transmission computer',
  U0121: 'Lost communication with ABS module',
  U0140: 'Lost communication with body control module',
  U0155: 'Lost communication with instrument cluster',
};

export function describeDtc(code: string): string | null {
  return DTC_NAMES[code] ?? null;
}
