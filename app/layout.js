import { orbitron, dm_mono, crimson_pro, inter } from './fonts';
import './globals.css';

export const metadata = {
  title: 'Orbit GEO - AI Visibility Auditor',
  description: 'Is Your Brand Invisible to AI? Find out with a 60-second audit.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${orbitron.variable} ${dm_mono.variable} ${crimson_pro.variable} ${inter.variable} ${inter.className}`}>
        {children}
      </body>
    </html>
  );
}