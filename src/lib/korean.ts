/**
 * 한국어 조사 선택. 마지막 글자의 받침 유무로 을/를, 이/가, 은/는 을 고른다.
 * 한글이 아닌 글자(영문·숫자·기호)로 끝나면 받침 없는 것으로 본다 (예: "id를").
 */
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const JONGSEONG_COUNT = 28;

export function hasFinalConsonant(word: string): boolean {
  const last = word.trimEnd().at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) return false;
  return (code - HANGUL_START) % JONGSEONG_COUNT !== 0;
}

type Particle = '을/를' | '이/가' | '은/는';

const PARTICLES: Record<Particle, [withFinal: string, withoutFinal: string]> = {
  '을/를': ['을', '를'],
  '이/가': ['이', '가'],
  '은/는': ['은', '는'],
};

/** `withParticle('사유', '을/를')` → `사유를`, `withParticle('품번', '을/를')` → `품번을` */
export function withParticle(word: string, particle: Particle): string {
  const [withFinal, withoutFinal] = PARTICLES[particle];
  return `${word}${hasFinalConsonant(word) ? withFinal : withoutFinal}`;
}
