import type { ReactNode, SVGProps } from "react";

// One stroke weight and one grid for every icon.
function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

type Props = SVGProps<SVGSVGElement>;

export const ArrowRight = (p: Props) => (
  <Icon {...p}>
    <path d="M3 12h17M14 5l7 7-7 7" />
  </Icon>
);

export const ArrowLeft = (p: Props) => (
  <Icon {...p}>
    <path d="M21 12H4M10 5l-7 7 7 7" />
  </Icon>
);

export const Play = (p: Props) => (
  <Icon {...p}>
    <path d="M7 4l13 8-13 8z" fill="currentColor" />
  </Icon>
);

export const Pause = (p: Props) => (
  <Icon {...p}>
    <path d="M8 5v14M16 5v14" />
  </Icon>
);

export const Save = (p: Props) => (
  <Icon {...p}>
    <path d="M12 3v13M6 11l6 6 6-6M4 21h16" />
  </Icon>
);

export const Folder = (p: Props) => (
  <Icon {...p}>
    <path d="M3 6h7l2 3h9v10H3z" />
  </Icon>
);

export const Alert = (p: Props) => (
  <Icon {...p}>
    <path d="M12 3l10 18H2zM12 10v5M12 18v.5" />
  </Icon>
);

export const Check = (p: Props) => (
  <Icon {...p}>
    <path d="M4 12l6 6L20 6" />
  </Icon>
);
