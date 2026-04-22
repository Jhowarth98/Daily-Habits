const CACHE = 'streak-v1';
const CHECK_TIMES = [9, 12, 15, 18]; // 9am, 12pm, 3pm, 6pm

const MOTIVATIONAL = [
  "You've got this — small steps every day. 🔥",
  "Consistency beats perfection every time.",
  "Your future self will thank you.",
  "One tick and you keep the streak alive!",
  "Don't let today be the day the flame goes out. 🔥",
  "Progress is progress, no matter how small.",
  "You started for a reason — keep going.",
  "Every day you show up counts.",
];

function getRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Listen for messages from the app
self.addEventListener('message', e => {
  if(e.data && e.data.type === 'SCHEDULE_NOTIFICATIONS'){
    scheduleChecks();
  }
});

// On push (from periodic sync or alarm)
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Streak', {
      body: data.body || 'Time to check your habits!',
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'streak-reminder',
      renotify: true,
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if(clients.length) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});

// Periodic background sync for scheduled checks
self.addEventListener('periodicsync', e => {
  if(e.tag === 'habit-check') e.waitUntil(checkAndNotify());
});

// Also check on fetch (every page load) as fallback
self.addEventListener('fetch', e => {
  checkAndNotify();
});

async function checkAndNotify(){
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isWeekday = !isWeekend;

  // Only fire at our target hours
  if(!CHECK_TIMES.includes(hour)) return;

  // Get state from all clients
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  if(!clients.length) return;

  // Ask the app for current state
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = e => {
      if(e.data && e.data.type === 'STATE'){
        handleState(e.data.state, hour, isWeekend, isWeekday);
      }
      resolve();
    };
    clients[0].postMessage({ type: 'GET_STATE' }, [channel.port2]);
    setTimeout(resolve, 3000);
  });
}

async function handleState(state, hour, isWeekend, isWeekday){
  if(!state || !state.habits || !state.habits.length) return;

  const today = new Date().toISOString().slice(0,10);

  // Find habits due today that aren't done
  const due = state.habits.filter(h => {
    const done = state.completions && state.completions[h.id + '_' + today];
    if(done) return false;
    if(h.freq === 'daily') return true;
    if(h.freq === 'weekdays') return isWeekday;
    if(h.freq === 'weekends') return isWeekend;
    return false;
  });

  if(!due.length) return;

  // Check we haven't already notified this hour
  const lastNotifKey = 'lastNotif_' + today + '_' + hour;
  const cache = await caches.open(CACHE);
  const existing = await cache.match(lastNotifKey);
  if(existing) return;
  // Mark as notified for this slot
  await cache.put(lastNotifKey, new Response('1'));

  // Build the notification
  let title, body;
  if(due.length === 1){
    const h = due[0];
    const streak = getStreak(state, h.id);
    title = `${h.icon} ${h.name}`;
    body = streak > 0
      ? `You're on a ${streak} day streak — don't break it now!`
      : `Time to complete "${h.name}" today.`;
  } else {
    title = '🔥 Check your habits';
    body = `You have ${due.length} habits due today. ${getRandom(MOTIVATIONAL)}`;
  }

  await self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'streak-reminder',
    renotify: true,
    vibrate: [200, 100, 200],
  });
}

function getStreak(state, id){
  const completions = state.completions || {};
  let streak = 0;
  const d = new Date();
  const todayKey = d.toISOString().slice(0,10);
  if(!completions[id + '_' + todayKey]) d.setDate(d.getDate()-1);
  for(let i=0; i<365; i++){
    const k = id + '_' + d.toISOString().slice(0,10);
    if(completions[k]){ streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  return streak;
}
