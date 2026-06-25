/* --- src/js/instruments/piano/config.js --- */

export const WHITE_KEY_WIDTH_VW = 4.7619;

// 88鍵の定義データ
export const PIANO_KEYS = [
    { n: 'A0', t: 'white' }, { n: 'As0', t: 'black' }, { n: 'B0', t: 'white' },
    { n: 'C1', t: 'white' }, { n: 'Cs1', t: 'black' }, { n: 'D1', t: 'white' }, { n: 'Ds1', t: 'black' }, { n: 'E1', t: 'white' }, { n: 'F1', t: 'white' }, { n: 'Fs1', t: 'black' }, { n: 'G1', t: 'white' }, { n: 'Gs1', t: 'black' }, { n: 'A1', t: 'white' }, { n: 'As1', t: 'black' }, { n: 'B1', t: 'white' },
    { n: 'C2', t: 'white' }, { n: 'Cs2', t: 'black' }, { n: 'D2', t: 'white' }, { n: 'Ds2', t: 'black' }, { n: 'E2', t: 'white' }, { n: 'F2', t: 'white' }, { n: 'Fs2', t: 'black' }, { n: 'G2', t: 'white' }, { n: 'Gs2', t: 'black' }, { n: 'A2', t: 'white' }, { n: 'As2', t: 'black' }, { n: 'B2', t: 'white' },
    { n: 'C3', t: 'white' }, { n: 'Cs3', t: 'black' }, { n: 'D3', t: 'white' }, { n: 'Ds3', t: 'black' }, { n: 'E3', t: 'white' }, { n: 'F3', t: 'white' }, { n: 'Fs3', t: 'black' }, { n: 'G3', t: 'white' }, { n: 'Gs3', t: 'black' }, { n: 'A3', t: 'white' }, { n: 'As3', t: 'black' }, { n: 'B3', t: 'white' },
    { n: 'C4', t: 'white' }, { n: 'Cs4', t: 'black' }, { n: 'D4', t: 'white' }, { n: 'Ds4', t: 'black' }, { n: 'E4', t: 'white' }, { n: 'F4', t: 'white' }, { n: 'Fs4', t: 'black' }, { n: 'G4', t: 'white' }, { n: 'Gs4', t: 'black' }, { n: 'A4', t: 'white' }, { n: 'As4', t: 'black' }, { n: 'B4', t: 'white' },
    { n: 'C5', t: 'white' }, { n: 'Cs5', t: 'black' }, { n: 'D5', t: 'white' }, { n: 'Ds5', t: 'black' }, { n: 'E5', t: 'white' }, { n: 'F5', t: 'white' }, { n: 'Fs5', t: 'black' }, { n: 'G5', t: 'white' }, { n: 'Gs5', t: 'black' }, { n: 'A5', t: 'white' }, { n: 'As5', t: 'black' }, { n: 'B5', t: 'white' },
    { n: 'C6', t: 'white' }, { n: 'Cs6', t: 'black' }, { n: 'D6', t: 'white' }, { n: 'Ds6', t: 'black' }, { n: 'E6', t: 'white' }, { n: 'F6', t: 'white' }, { n: 'Fs6', t: 'black' }, { n: 'G6', t: 'white' }, { n: 'Gs6', t: 'black' }, { n: 'A6', t: 'white' }, { n: 'As6', t: 'black' }, { n: 'B6', t: 'white' },
    { n: 'C7', t: 'white' }, { n: 'Cs7', t: 'black' }, { n: 'D7', t: 'white' }, { n: 'Ds7', t: 'black' }, { n: 'E7', t: 'white' }, { n: 'F7', t: 'white' }, { n: 'Fs7', t: 'black' }, { n: 'G7', t: 'white' }, { n: 'Gs7', t: 'black' }, { n: 'A7', t: 'white' }, { n: 'As7', t: 'black' }, { n: 'B7', t: 'white' },
    { n: 'C8', t: 'white' }
];

// キーボード配列
export const KEY_LAYOUT = [
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '^', '\\',
    'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '@', '[',
    'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', ':', ']',
    'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', '_'
];

// 表記変換マップ
export const FLAT_TO_SHARP = {
    'Db': 'Cs', 'Eb': 'Ds', 'Gb': 'Fs', 'Ab': 'Gs', 'Bb': 'As'
};