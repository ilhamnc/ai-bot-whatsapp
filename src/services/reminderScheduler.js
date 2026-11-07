// Scheduler: satu cron job per reminder aktif. Menjadwal ulang setiap ada perubahan dari dashboard.
import cron from 'node-cron';
import { TZ } from '../config.js';
import { getReminders, sendScheduledReminder } from '../models/reminderModel.js';

let jobs = new Map();

export function syncReminderSchedules(client, getIsReady) {
  for (const oldJob of jobs.values()) oldJob.stop();
  jobs = new Map();

  for (const reminder of getReminders()) {
    if (!reminder.enabled || !cron.validate(reminder.cron)) continue;
    const task = cron.schedule(reminder.cron, () => {
      void sendScheduledReminder(client, getIsReady(), reminder.id);
    }, { timezone: TZ, noOverlap: true });
    jobs.set(reminder.id, task);
  }
  console.log(`Jadwal reminder aktif: ${jobs.size}. Zona waktu: ${TZ}.`);
}

export function stopReminderSchedules() {
  for (const task of jobs.values()) task.stop();
  jobs.clear();
}
