import type { CSSProperties, SVGProps } from "react";
// 项目类型图标：detector 返回 {icon, iconSource}（CSS 字体类风格命名），
// 此组件映射为 iconify 图标集。devicon 集：去 "devicon-" 前缀 +
// "-plain"/"-original"/"-original-wordmark" 后缀；codicon 集：直传裸名。
// 映射表见 .slim/deepwork/react-webview-migration.md（Phase 0 spike 已逐个验证）。
import IconElectron from "~icons/devicon/electron";
import IconReact from "~icons/devicon/react";
import IconVue from "~icons/devicon/vuejs";
import IconTypeScript from "~icons/devicon/typescript";
import IconJavaScript from "~icons/devicon/javascript";
import IconJava from "~icons/devicon/java";
import IconPython from "~icons/devicon/python";
import IconCpp from "~icons/devicon/cplusplus";
import IconCSharp from "~icons/devicon/csharp";
import IconGo from "~icons/devicon/go";
import IconRust from "~icons/devicon/rust";
import IconPhp from "~icons/devicon/php";
import IconRuby from "~icons/devicon/ruby";
import IconSwift from "~icons/devicon/swift";
import IconKotlin from "~icons/devicon/kotlin";
import IconDart from "~icons/devicon/dart";
import IconNpm from "~icons/devicon/npm";
import IconVscode from "~icons/codicon/vscode";

/** unplugin-icons 组件统一签名（见 icons.d.ts）。 */
type IconComponent = (props: SVGProps<SVGSVGElement>) => React.JSX.Element;

// key = detector icon 原值
const DEVICON_MAP: Record<string, IconComponent> = {
  "devicon-electron-original": IconElectron,
  "devicon-react-original": IconReact,
  "devicon-vuejs-plain": IconVue,
  "devicon-typescript-plain": IconTypeScript,
  "devicon-javascript-plain": IconJavaScript,
  "devicon-java-plain": IconJava,
  "devicon-python-plain": IconPython,
  "devicon-cplusplus-plain": IconCpp,
  "devicon-csharp-plain": IconCSharp,
  "devicon-go-plain": IconGo,
  "devicon-rust-original": IconRust,
  "devicon-php-plain": IconPhp,
  "devicon-ruby-plain": IconRuby,
  "devicon-swift-plain": IconSwift,
  "devicon-kotlin-plain": IconKotlin,
  "devicon-dart-plain": IconDart,
  "devicon-npm-original-wordmark": IconNpm,
};

const CODICON_MAP: Record<string, IconComponent> = {
  vscode: IconVscode,
};

export interface ProjectIconProps {
  icon: string;
  iconSource: "codicon" | "devicon";
  /** 渲染尺寸（px），默认 20。 */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * 项目类型图标。devicon 着色（devicon 集 SVG 自带品牌色），codicon 跟随
 * --vscode-icon-foreground。未知图标回退 codicon vscode。
 */
export function ProjectIcon({
  icon,
  iconSource,
  size = 20,
  className,
  style,
}: ProjectIconProps) {
  const map = iconSource === "devicon" ? DEVICON_MAP : CODICON_MAP;
  const Comp: IconComponent = map[icon] ?? IconVscode;
  return (
    <Comp
      width={size}
      height={size}
      className={className}
      style={{
        color:
          iconSource === "codicon"
            ? "var(--vscode-icon-foreground)"
            : undefined,
        ...style,
      }}
    />
  );
}
