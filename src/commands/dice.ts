// Dice for Desk Commands: "d20", "2d6+3", "roll 3 d 8", "coin".

export interface Roll {
  text: string;
  rolls: number[];
  total: number;
  detail: string;
}

const MAX_DICE = 50;
const WORD_NUMBERS: Record<string, string> = { a: "1", an: "1", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6" };

const die = (sides: number) => 1 + Math.floor(Math.random() * sides);

export function rollDice(spec: string): Roll | null {
  const t = spec
    .toLowerCase()
    .replace(/\b(a|an|one|two|three|four|five|six)\b/g, (w) => WORD_NUMBERS[w])
    .replace(/\s+/g, "")
    .replace(/plus/g, "+")
    .replace(/minus/g, "-");
  if (/^(coin|flip|flipa?coin|coinflip|1coin)$/.test(t)) {
    const heads = Math.random() < 0.5;
    return { text: "Coin", rolls: [heads ? 1 : 0], total: heads ? 1 : 0, detail: heads ? "Heads" : "Tails" };
  }
  const m = (t || "d20").match(/^(\d*)d(\d+|%)([+-]\d+)?$/);
  if (!m) return null;
  const count = Math.min(Math.max(Number(m[1] || 1), 1), MAX_DICE);
  const sides = m[2] === "%" ? 100 : Number(m[2]);
  if (sides < 2 || sides > 1000) return null;
  const mod = Number(m[3] ?? 0);
  const rolls = Array.from({ length: count }, () => die(sides));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  const text = `${count > 1 ? count : ""}d${sides}${mod ? (mod > 0 ? `+${mod}` : mod) : ""}`;
  const detail = count > 1 || mod ? `${rolls.join(" + ")}${mod ? ` ${mod > 0 ? "+" : "−"} ${Math.abs(mod)}` : ""}` : "";
  return { text, rolls, total, detail };
}

export const rollLabel = (r: Roll) =>
  r.text === "Coin" ? `🪙 ${r.detail}` : `🎲 ${r.text}: ${r.total}${r.detail ? ` (${r.detail})` : ""}${r.rolls.length === 1 && r.total === Number(r.text.slice(1)) ? " — max!" : ""}`;
