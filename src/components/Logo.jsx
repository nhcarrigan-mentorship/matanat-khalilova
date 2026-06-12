/* eslint-disable react/prop-types */
import React from "react";

export default function Logo({
  className = "h-6 w-6",
  color = "currentColor",
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 26 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      className={className}
    >
      <line x1="3" y1="14" x2="3" y2="10" opacity="0.4" />
      <line x1="7" y1="12" x2="7" y2="8" opacity="0.7" />
      <line x1="11" y1="9" x2="11" y2="5" />
      <line x1="15" y1="9" x2="15" y2="5" />
      <line x1="19" y1="12" x2="19" y2="8" opacity="0.7" />
      <line x1="23" y1="14" x2="23" y2="10" opacity="0.4" />
    </svg>
  );
}
