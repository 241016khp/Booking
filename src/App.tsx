import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChevronRight, 
  ChevronLeft, 
  Check, 
  Calendar as CalendarIcon, 
  Clock, 
  User as UserIcon, 
  Phone, 
  Mail, 
  MessageSquare,
  Sparkles,
  Download,
  ExternalLink,
  LogOut,
  History,
  MapPin,
  X,
  Bell,
  Settings,
  CreditCard
} from 'lucide-react';
import { format, addDays, startOfToday, isSameDay, addMinutes, setHours, setMinutes, parseISO } from 'date-fns';
import { da } from 'date-fns/locale';
import { cn } from './lib/utils';
import { db, auth } from './firebase';
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import Calendar from './components/Calendar';

// --- Types ---
type Service = {
  id: string;
  name: string;
  description: string;
  duration: number; // in minutes
  price: number;
};

type BookingData = {
  service: Service | null;
  date: Date | null;
  time: string | null;
  paymentMethod: 'pay_in_store';
  customer: {
    name: string;
    phone: string;
    email: string;
    note: string;
  };
};

type NotificationPreferences = {
  emailConfirmations: boolean;
  emailReminders: boolean;
  pushConfirmations: boolean;
  pushReminders: boolean;
};

// --- Data ---
const SERVICES: Service[] = [
  {
    id: '1',
    name: 'Oliemassage',
    description: 'En afslappende massage med varme olier, der løsner spændinger og beroliger sindet.',
    duration: 30,
    price: 6,
  },
  {
    id: '2',
    name: 'Kærlig massage',
    description: 'En blid og omsorgsfuld helkropsmassage med fokus på velvære og nærvær.',
    duration: 30,
    price: 6,
  },
  {
    id: '3',
    name: 'Hård massage',
    description: 'Dybdegående massage til ømme muskler. Perfekt efter sport eller hårdt arbejde.',
    duration: 30,
    price: 6,
  },
  {
    id: '4',
    name: 'Wellness massage',
    description: 'En luksuriøs oplevelse der kombinerer forskellige teknikker for total afslapning.',
    duration: 30,
    price: 6,
  },
];

const TIME_SLOTS = [
  '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'
];

// --- Components ---

const StepIndicator = ({ currentStep }: { currentStep: number }) => {
  return (
    <div className="flex justify-center space-x-2 mb-8">
      {[1, 2, 3].map((step) => (
        <div
          key={step}
          className={cn(
            "h-1.5 rounded-full transition-all duration-500",
            currentStep === step ? "w-8 bg-black" : "w-2 bg-gray-200"
          )}
        />
      ))}
    </div>
  );
};

export default function App() {
  const [step, setStep] = useState(1); // 1: Service, 2: Date/Time, 3: Details, 4: Success, 5: My Bookings
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userBookings, setUserBookings] = useState<any[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    emailConfirmations: true,
    emailReminders: true,
    pushConfirmations: false,
    pushReminders: false,
  });
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [takenSlots, setTakenSlots] = useState<string[]>([]);
  const [booking, setBooking] = useState<BookingData>({
    service: null,
    date: null,
    time: null,
    paymentMethod: 'pay_in_store',
    customer: {
      name: '',
      phone: '',
      email: '',
      note: '',
    },
  });

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      
      if (currentUser) {
        // Update user profile in Firestore
        const userRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: currentUser.uid,
            email: currentUser.email,
            name: currentUser.displayName,
            createdAt: serverTimestamp(),
          });

          // Initialize default preferences
          const prefRef = doc(db, 'users', currentUser.uid, 'preferences', 'settings');
          await setDoc(prefRef, {
            emailConfirmations: true,
            emailReminders: true,
            pushConfirmations: false,
            pushReminders: false,
            updatedAt: serverTimestamp(),
          });
        }

        // Pre-fill booking info
        setBooking(prev => ({
          ...prev,
          customer: {
            ...prev.customer,
            name: prev.customer.name || currentUser.displayName || '',
            email: prev.customer.email || currentUser.email || '',
          }
        }));

        // Listen to user's bookings
        const q = query(
          collection(db, 'bookings'),
          where('userId', '==', currentUser.uid)
        );
        const unsubBookings = onSnapshot(q, (snapshot) => {
          const bookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setUserBookings(bookings.sort((a: any, b: any) => 
            new Date(b.createdAt?.toDate?.() || b.createdAt).getTime() - 
            new Date(a.createdAt?.toDate?.() || a.createdAt).getTime()
          ));
        });

        // Listen to user's preferences
        const prefRef = doc(db, 'users', currentUser.uid, 'preferences', 'settings');
        const unsubPrefs = onSnapshot(prefRef, (doc) => {
          if (doc.exists()) {
            setPreferences(doc.data() as NotificationPreferences);
          }
        });

        return () => {
          unsubBookings();
          unsubPrefs();
        };
      } else {
        setUserBookings([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time Availability Listener
  useEffect(() => {
    if (!booking.date) {
      setTakenSlots([]);
      return;
    }

    const dateStr = booking.date.toISOString().split('T')[0];
    const q = query(
      collection(db, 'bookings'),
      where('date', '>=', `${dateStr}T00:00:00`),
      where('date', '<=', `${dateStr}T23:59:59`),
      where('status', 'in', ['pending', 'approved'])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taken = snapshot.docs.map(doc => doc.data().time);
      setTakenSlots(taken);
    });

    return () => unsubscribe();
  }, [booking.date]);

  const [loginError, setLoginError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        // User closed the popup, no need to show a scary error
        console.log('Login popup was closed by user');
      } else if (error.code === 'auth/popup-blocked') {
        setLoginError('Login popup blev blokeret. Tillad venligst popups for denne side.');
      } else {
        console.error('Login error:', error);
        setLoginError('Der opstod en fejl under login. Prøv venligst igen.');
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setStep(1);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const cancelBooking = async (bookingId: string) => {
    try {
      await updateDoc(doc(db, 'bookings', bookingId), { status: 'cancelled' });
      // Notify admin about cancellation
      await fetch('/api/notify-admin-cancellation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      });
    } catch (error) {
      console.error('Cancel error:', error);
    }
  };

  const [isBooking, setIsBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const nextStep = async () => {
    if (step === 3) {
      setIsBooking(true);
      setBookingError(null);
      try {
        if (!booking.service || !booking.date || !booking.time) {
          throw new Error('Manglende booking detaljer');
        }

        const bookingData: any = {
          serviceId: booking.service.id,
          serviceName: booking.service.name,
          date: booking.date.toISOString(),
          time: booking.time,
          price: booking.service.price,
          paymentMethod: booking.paymentMethod,
          customerName: booking.customer.name,
          customerPhone: booking.customer.phone,
          customerEmail: booking.customer.email,
          customerNote: booking.customer.note,
          status: 'pending',
          reminderSent: false,
          createdAt: serverTimestamp(),
        };

        if (user) {
          bookingData.userId = user.uid;
        }

        const docRef = await addDoc(collection(db, 'bookings'), bookingData);
        
        // Notify admin via backend
        try {
          await fetch('/api/notify-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: docRef.id }),
          });
        } catch (notifyError) {
          console.error('Failed to notify admin:', notifyError);
          // We don't fail the whole booking if notification fails, 
          // but we log it. In a real app, we might retry or use a background job.
        }

        setStep(4);
      } catch (error) {
        console.error('Booking error:', error);
        setBookingError('Der opstod en fejl under din booking. Prøv venligst igen.');
      } finally {
        setIsBooking(false);
      }
    } else {
      setStep((s) => Math.min(s + 1, 4));
    }
  };
  const prevStep = () => setStep((s) => Math.max(s - 1, 1));

  const handleServiceSelect = (service: Service) => {
    setBooking((prev) => ({ ...prev, service }));
  };

  const handleDateSelect = (date: Date) => {
    setBooking((prev) => ({ ...prev, date }));
  };

  const handleTimeSelect = (time: string) => {
    setBooking((prev) => ({ ...prev, time }));
  };

  const togglePreference = async (key: keyof NotificationPreferences) => {
    if (!user) return;
    const newPrefs = { ...preferences, [key]: !preferences[key] };
    setPreferences(newPrefs);
    try {
      await setDoc(doc(db, 'users', user.uid, 'preferences', 'settings'), {
        ...newPrefs,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error saving preferences:', error);
    }
  };

  const handleCustomerChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setBooking((prev) => ({
      ...prev,
      customer: { ...prev.customer, [name]: value },
    }));
  };

  const getBookingDates = () => {
    if (!booking.date || !booking.time || !booking.service) return null;
    
    const [hours, minutes] = booking.time.split(':').map(Number);
    const startDate = setMinutes(setHours(booking.date, hours), minutes);
    const endDate = addMinutes(startDate, booking.service.duration);
    
    return { start: startDate, end: endDate };
  };

  const handleGoogleCalendarExport = () => {
    const dates = getBookingDates();
    if (!dates) return;

    const fmt = (d: Date) => format(d, "yyyyMMdd'T'HHmmss");
    const start = fmt(dates.start);
    const end = fmt(dates.end);
    
    const url = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.append('action', 'TEMPLATE');
    url.searchParams.append('text', `Massage: ${booking.service?.name}`);
    url.searchParams.append('dates', `${start}/${end}`);
    url.searchParams.append('details', `Din booking hos os.\nBehandling: ${booking.service?.name}\nNoter: ${booking.customer.note || 'Ingen'}`);
    url.searchParams.append('location', 'Vores Klinik');
    
    window.open(url.toString(), '_blank');
  };

  const handleICalExport = () => {
    const dates = getBookingDates();
    if (!dates) return;

    const fmt = (d: Date) => format(d, "yyyyMMdd'T'HHmmss");
    const start = fmt(dates.start);
    const end = fmt(dates.end);

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Booking App//DA',
      'BEGIN:VEVENT',
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:Massage: ${booking.service?.name}`,
      `DESCRIPTION:Behandling: ${booking.service?.name}\\nNoter: ${booking.customer.note || 'Ingen'}`,
      'LOCATION:Vores Klinik',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'booking.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const isStep1Valid = !!booking.service;
  const isStep2Valid = !!booking.date && !!booking.time;
  const isStep3Valid = 
    !!booking.customer.name && 
    !!booking.customer.phone && 
    isValidEmail(booking.customer.email);

  const showEmailError = booking.customer.email.length > 0 && !isValidEmail(booking.customer.email);

  return (
    <div className="min-h-screen bg-[#F2F2F7] text-[#1C1C1E] font-sans selection:bg-black selection:text-white">
      <div className="max-w-[400px] mx-auto min-h-screen bg-white shadow-2xl relative overflow-hidden flex flex-col">
        
        {/* iOS Status Bar Simulation */}
        <div className="h-12 px-8 flex items-center justify-between text-xs font-semibold sticky top-0 bg-white/80 backdrop-blur-xl z-30">
          <span>9:41</span>
          <div className="flex items-center space-x-1.5">
            <div className="w-4 h-4 rounded-full border border-black/20 flex items-center justify-center">
              <div className="w-2 h-2 bg-black rounded-full" />
            </div>
            <div className="flex space-x-0.5">
              <div className="w-1 h-3 bg-black rounded-sm" />
              <div className="w-1 h-3 bg-black rounded-sm" />
              <div className="w-1 h-3 bg-black/20 rounded-sm" />
            </div>
            <div className="w-6 h-3 border border-black/20 rounded-sm relative">
              <div className="absolute left-0.5 top-0.5 bottom-0.5 w-3 bg-black rounded-sm" />
            </div>
          </div>
        </div>

        {/* Header */}
        <header className="px-6 pt-4 pb-6 sticky top-12 bg-white/80 backdrop-blur-xl z-20">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-bold tracking-tight">
              {step === 1 && "Vælg behandling"}
              {step === 2 && "Tid & Dato"}
              {step === 3 && "Dine oplysninger"}
              {step === 4 && "Booking bekræftet"}
              {step === 5 && "Mine Bookinger"}
            </h1>
            <div className="flex items-center space-x-3">
              {user ? (
                <button 
                  onClick={() => setStep(step === 5 ? 1 : 5)}
                  className="w-10 h-10 rounded-full overflow-hidden border-2 border-gray-100 hover:border-black transition-colors"
                >
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                      <UserIcon className="w-5 h-5 text-gray-400" />
                    </div>
                  )}
                </button>
              ) : (
                <button 
                  onClick={handleLogin}
                  className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors"
                >
                  <UserIcon className="w-5 h-5 text-gray-400" />
                </button>
              )}
              {step < 4 && <Sparkles className="text-yellow-500 w-6 h-6" />}
            </div>
          </div>
          {step < 4 && <p className="text-gray-500 text-sm">Træd ind i en verden af ro og velvære</p>}
          {loginError && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-red-500 text-xs font-medium mt-2 bg-red-50 p-3 rounded-xl flex items-center justify-between"
            >
              <span>{loginError}</span>
              <button onClick={() => setLoginError(null)} className="p-1 hover:bg-red-100 rounded-full transition-colors">
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          )}
        </header>

        <main className="flex-1 px-6 pb-32">
          <AnimatePresence mode="wait">
            {step === 5 && (
              <motion.div
                key="step5"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between bg-gray-50 p-6 rounded-[32px]">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-full overflow-hidden">
                      <img src={user?.photoURL || ''} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                    <div>
                      <p className="font-bold">{user?.displayName}</p>
                      <p className="text-xs text-gray-500">{user?.email}</p>
                    </div>
                  </div>
                  <button onClick={handleLogout} className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors">
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 px-1">Dine aftaler</h3>
                  {userBookings.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-[32px] space-y-4">
                      <History className="w-12 h-12 text-gray-200 mx-auto" />
                      <p className="text-gray-500">Du har ingen bookinger endnu.</p>
                      <button onClick={() => setStep(1)} className="text-black font-bold underline">Book din første tid</button>
                    </div>
                  ) : (
                    userBookings.map((b) => (
                      <div key={b.id} className="bg-white border border-gray-100 p-6 rounded-[32px] shadow-sm space-y-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-bold text-lg">{b.serviceName}</p>
                            <p className="text-sm text-gray-500">
                              {format(parseISO(b.date), 'd. MMMM yyyy', { locale: da })} kl. {b.time}
                            </p>
                          </div>
                          <div className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                            b.status === 'approved' ? "bg-green-100 text-green-700" :
                            b.status === 'pending' ? "bg-yellow-100 text-yellow-700" :
                            b.status === 'rejected' ? "bg-red-100 text-red-700" :
                            "bg-gray-100 text-gray-700"
                          )}>
                            {b.status === 'approved' ? 'Bekræftet' :
                             b.status === 'pending' ? 'Afventer' :
                             b.status === 'rejected' ? 'Afvist' : 'Annulleret'}
                          </div>
                        </div>
                        {b.status === 'pending' || b.status === 'approved' ? (
                          <button 
                            onClick={() => cancelBooking(b.id)}
                            className="w-full py-3 bg-red-50 text-red-600 rounded-2xl text-sm font-bold hover:bg-red-100 transition-colors"
                          >
                            Annuller booking
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                {/* Notification Preferences */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 px-1">Notifikationer</h3>
                  <div className="bg-white border border-gray-100 rounded-[32px] overflow-hidden shadow-sm">
                    <div className="p-6 space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                            <Mail className="w-5 h-5 text-blue-500" />
                          </div>
                          <div>
                            <p className="font-bold text-sm">Email bekræftelser</p>
                            <p className="text-[10px] text-gray-500">Få besked når din tid er godkendt</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => togglePreference('emailConfirmations')}
                          className={cn(
                            "w-12 h-6 rounded-full transition-colors relative",
                            preferences.emailConfirmations ? "bg-black" : "bg-gray-200"
                          )}
                        >
                          <motion.div 
                            animate={{ x: preferences.emailConfirmations ? 26 : 2 }}
                            className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
                            <Clock className="w-5 h-5 text-purple-500" />
                          </div>
                          <div>
                            <p className="font-bold text-sm">Email påmindelser</p>
                            <p className="text-[10px] text-gray-500">Vi sender en mail 24 timer før</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => togglePreference('emailReminders')}
                          className={cn(
                            "w-12 h-6 rounded-full transition-colors relative",
                            preferences.emailReminders ? "bg-black" : "bg-gray-200"
                          )}
                        >
                          <motion.div 
                            animate={{ x: preferences.emailReminders ? 26 : 2 }}
                            className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>

                      <div className="h-[1px] bg-gray-100" />

                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
                            <Bell className="w-5 h-5 text-orange-500" />
                          </div>
                          <div>
                            <p className="font-bold text-sm">Push bekræftelser</p>
                            <p className="text-[10px] text-gray-500">Hurtig besked på din telefon</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => togglePreference('pushConfirmations')}
                          className={cn(
                            "w-12 h-6 rounded-full transition-colors relative",
                            preferences.pushConfirmations ? "bg-black" : "bg-gray-200"
                          )}
                        >
                          <motion.div 
                            animate={{ x: preferences.pushConfirmations ? 26 : 2 }}
                            className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                            <Settings className="w-5 h-5 text-green-500" />
                          </div>
                          <div>
                            <p className="font-bold text-sm">Push påmindelser</p>
                            <p className="text-[10px] text-gray-500">Glem aldrig din næste tid</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => togglePreference('pushReminders')}
                          className={cn(
                            "w-12 h-6 rounded-full transition-colors relative",
                            preferences.pushReminders ? "bg-black" : "bg-gray-200"
                          )}
                        >
                          <motion.div 
                            animate={{ x: preferences.pushReminders ? 26 : 2 }}
                            className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                className="space-y-4"
              >
                <StepIndicator currentStep={1} />
                {SERVICES.map((service) => (
                  <motion.button
                    key={service.id}
                    whileTap={{ scale: 0.98 }}
                    whileHover={{ scale: 1.01 }}
                    onClick={() => handleServiceSelect(service)}
                    className={cn(
                      "w-full text-left p-6 rounded-[28px] transition-all duration-500 border-2",
                      booking.service?.id === service.id
                        ? "bg-[#1C1C1E] text-white border-transparent shadow-xl scale-[1.02]"
                        : "bg-white border-gray-100 text-[#1C1C1E] hover:border-gray-200"
                    )}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center">
                        <h3 className="text-xl font-semibold">{service.name}</h3>
                        {booking.service?.id === service.id && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="ml-2 bg-white rounded-full p-0.5"
                          >
                            <Check className="w-3 h-3 text-black" />
                          </motion.div>
                        )}
                      </div>
                      <span className={cn(
                        "text-lg font-medium",
                        booking.service?.id === service.id ? "text-gray-300" : "text-gray-500"
                      )}>
                        {service.price} kr.
                      </span>
                    </div>
                    <p className={cn(
                      "text-sm mb-4 line-clamp-2 leading-relaxed",
                      booking.service?.id === service.id ? "text-gray-400" : "text-gray-500"
                    )}>
                      {service.description}
                    </p>
                    <div className="flex items-center text-xs font-medium uppercase tracking-wider opacity-60">
                      <Clock className="w-3 h-3 mr-1" />
                      {service.duration} minutter
                    </div>
                  </motion.button>
                ))}
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                className="space-y-8"
              >
                <StepIndicator currentStep={2} />
                
                {/* Date Selector */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-400 px-1">Vælg dato</h3>
                  <Calendar 
                    selectedDate={booking.date} 
                    onDateSelect={handleDateSelect} 
                  />
                </div>

                {/* Time Selector */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-400 px-1">Vælg tidspunkt</h3>
                  <div className="grid grid-cols-3 gap-3">
                    {TIME_SLOTS.map((time) => {
                      const isSelected = booking.time === time;
                      const isTaken = takenSlots.includes(time);
                      return (
                        <motion.button
                          key={time}
                          disabled={isTaken}
                          whileTap={!isTaken ? { scale: 0.95 } : {}}
                          whileHover={!isTaken ? { scale: 1.02 } : {}}
                          animate={isSelected ? { 
                            scale: 1.05,
                            y: -2,
                            transition: { type: "spring", stiffness: 400, damping: 10 }
                          } : { 
                            scale: 1,
                            y: 0 
                          }}
                          onClick={() => handleTimeSelect(time)}
                          className={cn(
                            "py-4 rounded-2xl text-sm font-bold transition-all duration-500 border-2",
                            isSelected
                              ? "bg-black text-white border-transparent shadow-xl"
                              : isTaken
                                ? "bg-gray-50 border-transparent text-gray-300 cursor-not-allowed"
                                : "bg-white border-gray-100 text-gray-600 hover:border-gray-200"
                          )}
                        >
                          {time}
                          {isTaken && <div className="text-[8px] opacity-50">Optaget</div>}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* Summary Box */}
                {booking.service && booking.date && booking.time && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gray-50 p-6 rounded-[32px] border border-gray-100"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                        <CalendarIcon className="w-6 h-6 text-black" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Din booking</p>
                        <p className="font-semibold">{booking.service.name}</p>
                        <p className="text-sm text-gray-500">
                          {format(booking.date, 'd. MMMM', { locale: da })} kl. {booking.time}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                className="space-y-6"
              >
                <StepIndicator currentStep={3} />
                
                <div className="space-y-4">
                  <div className="relative">
                    <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      name="name"
                      placeholder="Fulde navn"
                      value={booking.customer.name}
                      onChange={handleCustomerChange}
                      className="w-full pl-12 pr-4 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-black focus:bg-white focus:scale-[1.01] focus:shadow-md transition-all duration-300 outline-none text-lg font-medium"
                    />
                  </div>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="tel"
                      name="phone"
                      placeholder="Telefonnummer"
                      value={booking.customer.phone}
                      onChange={handleCustomerChange}
                      className="w-full pl-12 pr-4 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-black focus:bg-white focus:scale-[1.01] focus:shadow-md transition-all duration-300 outline-none text-lg font-medium"
                    />
                  </div>
                  <div className="relative">
                    <Mail className={cn("absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors", showEmailError ? "text-red-400" : "text-gray-400")} />
                    <input
                      type="email"
                      name="email"
                      placeholder="E-mail adresse"
                      value={booking.customer.email}
                      onChange={handleCustomerChange}
                      className={cn(
                        "w-full pl-12 pr-4 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 transition-all duration-300 outline-none text-lg font-medium focus:scale-[1.01] focus:shadow-md",
                        showEmailError ? "focus:ring-red-500 bg-red-50/30" : "focus:ring-black focus:bg-white"
                      )}
                    />
                    {showEmailError && (
                      <motion.span 
                        initial={{ opacity: 0, x: -5 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-red-500 uppercase tracking-wider"
                      >
                        Ugyldig e-mail
                      </motion.span>
                    )}
                  </div>
                  <div className="relative">
                    <MessageSquare className="absolute left-4 top-6 w-5 h-5 text-gray-400" />
                    <textarea
                      name="note"
                      placeholder="Eventuelle noter (valgfrit)"
                      value={booking.customer.note}
                      onChange={handleCustomerChange}
                      rows={3}
                      className="w-full pl-12 pr-4 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-black focus:bg-white focus:scale-[1.01] focus:shadow-md transition-all duration-300 outline-none text-lg font-medium resize-none"
                    />
                  </div>
                </div>

                {/* Payment Method */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-400 px-1">Betalingsmetode</h3>
                  <div className="bg-gray-50 p-6 rounded-[28px] border-2 border-black flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                        <CreditCard className="w-6 h-6 text-black" />
                      </div>
                      <div>
                        <p className="font-bold">Betal i butikken</p>
                        <p className="text-xs text-gray-500">Betal kontant eller med kort ved ankomst</p>
                      </div>
                    </div>
                    <div className="w-6 h-6 rounded-full bg-black flex items-center justify-center">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  </div>
                </div>

                {bookingError && (
                  <motion.p 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-500 text-sm font-medium text-center"
                  >
                    {bookingError}
                  </motion.p>
                )}

                {/* Final Summary */}
                <div className="bg-gray-900 text-white p-6 rounded-[32px] shadow-xl space-y-4">
                  <div className="flex justify-between items-center border-b border-white/10 pb-4">
                    <span className="text-gray-400 text-sm">Behandling</span>
                    <span className="font-semibold">{booking.service?.name}</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-white/10 pb-4">
                    <span className="text-gray-400 text-sm">Tidspunkt</span>
                    <span className="font-semibold">
                      {booking.date && format(booking.date, 'd. MMM', { locale: da })} kl. {booking.time}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-gray-400 text-sm">Total pris</span>
                    <span className="text-2xl font-bold">{booking.service?.price} kr.</span>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                className="flex flex-col items-center justify-center text-center space-y-8 pt-12"
              >
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1, duration: 0.5, ease: "easeOut" }}
                  className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center relative"
                >
                  <motion.div
                    initial={{ scale: 0, rotate: -45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ 
                      delay: 0.3, 
                      type: 'spring', 
                      stiffness: 300, 
                      damping: 15 
                    }}
                  >
                    <Check className="w-12 h-12 text-green-600" strokeWidth={3} />
                  </motion.div>
                  {/* Subtle pulse ring */}
                  <motion.div 
                    initial={{ scale: 1, opacity: 0.5 }}
                    animate={{ scale: 1.5, opacity: 0 }}
                    transition={{ delay: 0.6, duration: 1, repeat: Infinity, repeatDelay: 2 }}
                    className="absolute inset-0 bg-green-100 rounded-full -z-10"
                  />
                </motion.div>
                
                <div className="space-y-2">
                  <h2 className="text-3xl font-bold">Tak for din anmodning!</h2>
                  <p className="text-gray-500">Din booking er modtaget og afventer godkendelse.</p>
                  <p className="text-sm text-gray-400">Vi sender dig en mail så snart vi har behandlet din anmodning.</p>
                </div>

                <div className="w-full bg-gray-50 p-8 rounded-[40px] space-y-4 text-left">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">Find vej</h3>
                  <div className="w-full aspect-video rounded-2xl overflow-hidden border border-gray-200 relative">
                    <iframe
                      src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2248.123456789!2d9.4123456!3d55.754321!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x464c7f0f0f0f0f0f%3A0x0f0f0f0f0f0f0f0f!2sL%C3%A6rkevej%205%2C%207300%20Jelling!5e0!3m2!1sda!2sdk!4v1620000000000!5m2!1sda!2sdk"
                      width="100%"
                      height="100%"
                      style={{ border: 0 }}
                      allowFullScreen={false}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    ></iframe>
                    <div className="absolute bottom-3 right-3">
                      <a 
                        href="https://www.google.com/maps/search/?api=1&query=Lærkevej+5,+7300+Jelling" 
                        target="_blank" 
                        rel="noreferrer"
                        className="bg-white p-2 rounded-lg shadow-md flex items-center space-x-1 text-xs font-bold"
                      >
                        <MapPin className="w-3 h-3" />
                        <span>Åbn i Maps</span>
                      </a>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">Lærkevej 5, 7300 Jelling</p>
                </div>

                <div className="w-full bg-gray-50 p-8 rounded-[40px] space-y-4 text-left">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400">Booking detaljer</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Kunde</span>
                      <span className="font-semibold">{booking.customer.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Behandling</span>
                      <span className="font-semibold">{booking.service?.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Dato</span>
                      <span className="font-semibold">{booking.date && format(booking.date, 'd. MMMM', { locale: da })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Tid</span>
                      <span className="font-semibold">kl. {booking.time}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Betaling</span>
                      <span className="font-semibold">Betal i butikken</span>
                    </div>
                  </div>
                </div>

                <div className="w-full space-y-3">
                  <p className="text-sm font-bold text-gray-400 uppercase tracking-widest text-center mb-1">Tilføj til kalender</p>
                  <div className="grid grid-cols-2 gap-3">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      whileHover={{ scale: 1.02 }}
                      onClick={handleGoogleCalendarExport}
                      className="flex items-center justify-center space-x-2 py-4 bg-white border-2 border-gray-100 rounded-2xl font-bold text-sm hover:border-gray-200 transition-all"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Google</span>
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      whileHover={{ scale: 1.02 }}
                      onClick={handleICalExport}
                      className="flex items-center justify-center space-x-2 py-4 bg-white border-2 border-gray-100 rounded-2xl font-bold text-sm hover:border-gray-200 transition-all"
                    >
                      <Download className="w-4 h-4" />
                      <span>iCal / Outlook</span>
                    </motion.button>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setStep(1);
                    setBooking({
                      service: null,
                      date: null,
                      time: null,
                      paymentMethod: 'pay_in_store',
                      customer: { name: '', phone: '', email: '', note: '' },
                    });
                  }}
                  className="w-full py-5 bg-black text-white rounded-[24px] font-bold text-lg shadow-xl hover:scale-[1.02] transition-transform"
                >
                  Book en ny tid
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Footer Navigation */}
        {step < 4 && (
          <footer className="p-6 pb-10 sticky bottom-0 bg-white/80 backdrop-blur-xl border-t border-gray-100 flex space-x-4">
            {step > 1 && (
              <button
                onClick={prevStep}
                className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}
            <button
              disabled={
                isBooking ||
                (step === 1 && !isStep1Valid) ||
                (step === 2 && !isStep2Valid) ||
                (step === 3 && !isStep3Valid)
              }
              onClick={nextStep}
              className={cn(
                "flex-1 h-16 rounded-[24px] font-bold text-lg flex items-center justify-center transition-all duration-300 shadow-lg",
                ((step === 1 && isStep1Valid) || (step === 2 && isStep2Valid) || (step === 3 && isStep3Valid))
                  ? "bg-black text-white shadow-black/20"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"
              )}
            >
              {isBooking ? (
                <div className="flex items-center">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                  Behandler...
                </div>
              ) : (
                <>
                  {step === 3 ? "Bekræft booking" : "Fortsæt"}
                  <ChevronRight className="w-5 h-5 ml-2" />
                </>
              )}
            </button>
          </footer>
        )}
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
