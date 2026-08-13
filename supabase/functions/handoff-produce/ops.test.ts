import { assert, assertEquals } from "jsr:@std/assert@1";
import { killSwitchOn } from "./ops.ts";

Deno.test(
  "killSwitchOn: unset / empty / arbitrary values keep production ENABLED (safe default)",
  () => {
    for (const v of [undefined, null, "", "  ", "false", "0", "no", "off", "disabled", "maybe"]) {
      assertEquals(killSwitchOn(v), false, `${JSON.stringify(v)} must not engage the switch`);
    }
  }
);

Deno.test(
  "killSwitchOn: the documented truthy spellings engage the switch (case/space tolerant)",
  () => {
    for (const v of ["1", "true", "TRUE", "yes", "Yes", "on", " on ", "  true  "]) {
      assert(killSwitchOn(v), `${JSON.stringify(v)} must engage the switch`);
    }
  }
);
