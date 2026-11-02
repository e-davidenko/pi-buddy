/** pi-buddy: композиция слоёв — см. adapters/pi/extension.ts */
import { createBuddy } from "./adapters/pi/extension.ts";

export default function buddy(pi: any) {
  createBuddy(pi);
}
