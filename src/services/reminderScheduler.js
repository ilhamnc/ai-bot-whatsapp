// Scheduler membuat satu cron job per jam reminder aktif dan menyinkronkan perubahan dashboard.
import cron from 'node-cron';
import { getPrayerReminderSettings, getReminders, sendScheduledReminder } from '../models/reminderModel.js';
import { createPrayerReminderTask } from './prayerReminderService.js';

let jobs = new Map();

export function syncReminderSchedules(client, getIsReady) {
  const timezone = getPrayerReminderSettings().timezone;
  for (const oldJob of jobs.values()) oldJob.stop();
  jobs = new Map();

  for (const reminder of getReminders()) {
    if (!reminder.enabled) continue;
    const expressions = reminder.cronExpressions || [reminder.cron];
    expressions.forEach((expression, index) => {
      if (!cron.validate(expression)) return;
      const task = cron.schedule(expression, () => {
        void sendScheduledReminder(client, getIsReady(), reminder.id);
      }, { timezone, noOverlap: true });
      jobs.set(`${reminder.id}:${index}`, task);
    });
  }
  if (getPrayerReminderSettings().enabled) {
    jobs.set('prayer-reminders', createPrayerReminderTask(client, getIsReady));
  }
  console.log(`Jadwal reminder aktif: ${jobs.size}. Zona waktu: ${timezone}.`);
}

export function stopReminderSchedules() {
  for (const task of jobs.values()) task.stop();
  jobs.clear();
}
