'use client';
import { useEffect, useRef } from 'react';

interface VesselPosition {
  lat: number;
  lng: number;
  location: string;
}

interface VesselMapProps {
  position: VesselPosition;
  destination?: string;
  route?: { lat: number; lng: number }[];
  vesselName: string;
}

// Google Maps Embed URL
function getMapUrl(lat: number, lng: number, zoom: number = 6): string {
  return `https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d${zoom}!2d${lng}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e1!3m2!1sen!2sus!4v1600000000000!5m2!1sen!2sus`;
}

const NS = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`;

// Generate OpenStreetMap URL with marker
function getOSMUrl(lat: number, lng: number, zoom: number = 8): string {
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng-2}%2C${lat-2}%2C${lng+2}%2C${lat+2}&layer=mapnik&marker=${lat}%2C${lng}`;
}

export default function VesselMap({ position, route, vesselName }: VesselMapProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // Reload iframe when position changes
    if (iframeRef.current) {
      iframeRef.current.src = getOSMUrl(position.lat, position.lng, 7);
    }
  }, [position.lat, position.lng]);

  return (
    <div className="vessel-map">
      <div className="vessel-map__header">
        <span className="vessel-map__title">📍 موقع {vesselName}</span>
        <div className="vessel-map__coords">
          {NS(position.lat, 'N', 'S')}, {NS(position.lng, 'E', 'W')}
        </div>
      </div>
      
      <div className="vessel-map__container">
        <iframe
          ref={iframeRef}
          src={getOSMUrl(position.lat, position.lng, 7)}
          className="vessel-map__iframe"
          title={`موقع ${vesselName}`}
          allowFullScreen
          loading="lazy"
        />
        
        {/* Route overlay if available */}
        {route && route.length > 0 && (
          <div className="vessel-map__route-info">
            <div className="vessel-map__route-line">
              <span className="vessel-map__start">🟢 نقطة البداية</span>
              <div className="vessel-map__path">
                <svg viewBox="0 0 200 40" className="vessel-map__route-svg">
                  <line x1="10" y1="20" x2="190" y2="20" stroke="#06b6d4" strokeWidth="2" strokeDasharray="5,5" />
                  <circle cx="10" cy="20" r="6" fill="#10b981" />
                  <circle cx="190" cy="20" r="6" fill="#ef4444" />
                  <text x="10" y="35" textAnchor="middle" fill="#94a3b8" fontSize="8">البداية</text>
                  <text x="190" y="35" textAnchor="middle" fill="#94a3b8" fontSize="8">الوجهة</text>
                </svg>
              </div>
              <span className="vessel-map__end">🔴 الوجهة</span>
            </div>
            <div className="vessel-map__route-stats">
              <span>عدد نقاط المسار: {route.length}</span>
              <span>المسافة التقريبية: {calculateDistance(route)} كم</span>
            </div>
          </div>
        )}
      </div>

      <div className="vessel-map__footer">
        <a 
          href={`https://www.google.com/maps/search/?api=1&query=${position.lat},${position.lng}`}
          target="_blank"
          rel="noreferrer noopener"
          className="vessel-map__link"
        >
          فتح في Google Maps ↗
        </a>
        <a 
          href={`https://www.openstreetmap.org/?mlat=${position.lat}&mlon=${position.lng}&zoom=10`}
          target="_blank"
          rel="noreferrer noopener"
          className="vessel-map__link"
        >
          فتح في OpenStreetMap ↗
        </a>
      </div>
    </div>
  );
}

// Calculate approximate distance in km
function calculateDistance(points: { lat: number; lng: number }[]): string {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += haversine(points[i], points[i + 1]);
  }
  return total.toFixed(0);
}

// Haversine formula for distance calculation
function haversine(p1: { lat: number; lng: number }, p2: { lat: number; lng: number }): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(p2.lat - p1.lat);
  const dLon = toRad(p2.lng - p1.lng);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
