declare module "~icons/*" {
  import type React from "react";
  import type { SVGProps } from "react";
  const component: (props: SVGProps<SVGSVGElement>) => React.JSX.Element;
  export default component;
}
