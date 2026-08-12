/** 10-полосный эквалайзер: частоты из WebAudioAdapter.EQ_FREQUENCIES. */
export const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];

export interface EqualizerPreset {
  id: string;
  name: string;
  gains: number[];
}

export const EQ_PRESETS: EqualizerPreset[] = [
  { id: "flat", name: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "rock", name: "Rock", gains: [4, 3, 1, 0, -1, 1, 3, 4, 4, 3] },
  { id: "pop", name: "Pop", gains: [-1, 2, 3, 3, 1, -1, -2, -1, 0, 1] },
  { id: "jazz", name: "Jazz", gains: [3, 2, 1, 2, -1, -2, 1, 2, 3, 3] },
  { id: "electronic", name: "Electronic", gains: [5, 3, 0, -2, -1, 2, 4, 5, 5, 4] },
  { id: "classical", name: "Classical", gains: [3, 2, 1, 0, -1, -1, 1, 3, 3, 3] },
];
