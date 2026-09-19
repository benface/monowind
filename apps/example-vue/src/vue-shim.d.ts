// Single-file components as modules, for tsc; Vue's plugin compiles them.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}
