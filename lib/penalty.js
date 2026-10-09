// Penales del sorteo: dónde patea el jugador, adónde se tira el arquero y qué pasa.
//
// El arco tiene 5 lugares: ángulo izquierdo (tl), abajo a la izquierda (bl), medio (c),
// ángulo derecho (tr) y abajo a la derecha (br). El arquero se tira al azar a la izquierda,
// al medio o a la derecha.
//   - Abajo o al medio: si el arquero adivina el lado, ataja.
//   - En un ángulo: 10% pega en el palo, 10% se va afuera; si va al arco, el arquero que adivina
//     el lado la saca la mitad de las veces.
// Con eso cualquier lugar termina en gol 2 de cada 3 veces: elegir es cuestión de gusto y de nervios.

export const ZONES = ["tl", "bl", "c", "tr", "br"];
export const DIVES = ["L", "C", "R"];

const sideOf = (zone) => (zone === "c" ? "C" : zone[1] === "l" ? "L" : "R");

/** rand(n) -> entero en [0, n). Devuelve { dive, result } con result: gol | atajada | palo | afuera. */
export function shoot(zone, rand) {
  const dive = DIVES[rand(3)];
  const guessed = dive === sideOf(zone);
  if (zone[0] === "t") {
    const r = rand(100);
    if (r < 10) return { dive, result: "palo" };
    if (r < 20) return { dive, result: "afuera" };
    return { dive, result: guessed && rand(2) === 0 ? "atajada" : "gol" };
  }
  return { dive, result: guessed ? "atajada" : "gol" };
}
