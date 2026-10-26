// Public share artwork contains no resident information or voting activity.
import { ImageResponse } from "next/og";

export const alt =
  "Civic Pulse - Resident Welfare Association voting and polls";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "#F8FAFC",
        color: "#0F172A",
        borderLeft: "24px solid #0F766E",
      }}
    >
      <div style={{ fontSize: 88, fontWeight: 700 }}>Civic Pulse</div>
      <div style={{ fontSize: 36, marginTop: 24, color: "#475569" }}>
        Resident Welfare Association
      </div>
      <div style={{ fontSize: 36, marginTop: 12, color: "#0F766E" }}>
        Voting and polls for registered members
      </div>
    </div>,
    size,
  );
}
