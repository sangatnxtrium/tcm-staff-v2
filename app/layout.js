import "./globals.css";
export const metadata = {
  title: "TCM Staff",
  description: "The operating system for TCM's collectibles business",
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
    <body>{children}</body>
    </html>
  );
}
