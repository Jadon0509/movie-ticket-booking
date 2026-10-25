export type Role = 'customer' | 'admin';
export interface User { id: number; name: string; email: string; role: Role }
export interface Movie { id: number; title: string; description: string; posterUrl: string; language: string; durationMinutes: number; rating: 'U' | 'UA' | 'A' }
export interface ShowSummary { id: number; startsAt: string; endsAt: string; price: number; availableSeats: number }
export type SeatStatus = 'available' | 'held' | 'booked' | 'mine' | 'damaged';
export interface Seat { row: string; number: number; label: string; status: SeatStatus }
export interface ShowInfo {
  id: number; movieId: number; startsAt: string; endsAt: string; price: number; availableSeats: number; started: boolean;
  movie: { title: string; posterUrl: string; language: string; rating: string; durationMinutes: number };
}
export interface Hold { seats: string[]; expiresAt: string }
export interface SeatMapResponse { show: ShowInfo; seats: Seat[]; availableCount: number; myHold: Hold | null; serverTime: string }
export interface Booking {
  id: number; status: 'confirmed' | 'cancelled'; totalAmount: number; createdAt: string; cancelledAt: string | null;
  showId: number; startsAt: string; endsAt: string; movie: { title: string; posterUrl: string; language: string }; seats: string[];
}
export interface AdminShow { id: number; movieId: number; movieTitle: string; startsAt: string; endsAt: string; price: number; bookedSeats: number; totalSeats: number; percentFull: number; revenue: number }
export interface AdminBooking { id: number; status: string; customerName: string; totalAmount: number; bookedAt: string; seats: string[] }
