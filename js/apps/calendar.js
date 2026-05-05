// NOVA OS — Calendar App

import { processManager } from '../kernel/process-manager.js';

export function registerCalendar() {
  processManager.register('calendar', {
    name: 'Calendar',
    icon: '\uD83D\uDCC5',
    iconClass: 'dock-icon-calendar',
    singleInstance: true,
    width: 800,
    height: 550,
    launch: (contentEl) => {
      initCalendar(contentEl);
    }
  });
}

function initCalendar(container) {
  const today = new Date();
  let viewMonth = today.getMonth();
  let viewYear = today.getFullYear();
  let selectedDate = today;

  // Sample events
  const events = [
    { title: 'Team Standup', day: today.getDate(), hour: 9, duration: 1, color: '#007aff' },
    { title: 'Lunch Break', day: today.getDate(), hour: 12, duration: 1, color: '#34c759' },
    { title: 'Astrion OS Dev', day: today.getDate(), hour: 14, duration: 3, color: '#5856d6' },
    { title: 'Code Review', day: today.getDate() + 1, hour: 10, duration: 2, color: '#ff9500' },
    { title: 'Design Session', day: today.getDate() + 2, hour: 11, duration: 1.5, color: '#ff2d55' },
  ];

  container.innerHTML = `
    <div class="calendar-app">
      <div class="calendar-sidebar">
        <div class="calendar-mini" id="cal-mini"></div>
        <div class="calendar-calendars-title">Calendars</div>
        <div class="calendar-cal-item"><div class="calendar-cal-dot" style="background:#007aff"></div> Work</div>
        <div class="calendar-cal-item"><div class="calendar-cal-dot" style="background:#34c759"></div> Personal</div>
        <div class="calendar-cal-item"><div class="calendar-cal-dot" style="background:#ff9500"></div> School</div>
        <div class="calendar-cal-item"><div class="calendar-cal-dot" style="background:#5856d6"></div> Projects</div>
      </div>
      <div class="calendar-main">
        <div class="calendar-header">
          <div class="calendar-header-title" id="cal-header-title"></div>
          <div class="calendar-header-nav">
            <button class="calendar-header-btn" id="cal-today">Today</button>
            <button class="calendar-header-btn" id="cal-prev">\u25C0</button>
            <button class="calendar-header-btn" id="cal-next">\u25B6</button>
          </div>
        </div>
        <div class="calendar-week-view" id="cal-week-view"></div>
      </div>
    </div>
  `;

  const miniEl = container.querySelector('#cal-mini');
  const weekView = container.querySelector('#cal-week-view');
  const headerTitle = container.querySelector('#cal-header-title');

  container.querySelector('#cal-prev').addEventListener('click', () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderMini();
    renderWeek();
  });

  container.querySelector('#cal-next').addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderMini();
    renderWeek();
  });

  container.querySelector('#cal-today').addEventListener('click', () => {
    viewMonth = today.getMonth();
    viewYear = today.getFullYear();
    selectedDate = today;
    renderMini();
    renderWeek();
  });

  function renderMini() {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

    let html = `
      <div class="calendar-mini-header">
        <span>${monthNames[viewMonth]} ${viewYear}</span>
      </div>
      <div class="calendar-mini-grid">
        ${dayNames.map(d => `<div class="calendar-mini-day-header">${d}</div>`).join('')}
    `;

    // Previous month's trailing days
    for (let i = firstDay - 1; i >= 0; i--) {
      html += `<div class="calendar-mini-day other-month">${daysInPrev - i}</div>`;
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
      html += `<div class="calendar-mini-day${isToday ? ' today' : ''}">${d}</div>`;
    }

    // Fill remaining
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
      html += `<div class="calendar-mini-day other-month">${d}</div>`;
    }

    html += '</div>';
    miniEl.innerHTML = html;
  }

  function renderWeek() {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    headerTitle.textContent = `${monthNames[viewMonth]} ${viewYear}`;

    // Get the week containing the first of the view month (or today)
    const baseDate = (viewMonth === today.getMonth() && viewYear === today.getFullYear()) ? today : new Date(viewYear, viewMonth, 1);
    const weekStart = new Date(baseDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    let html = '<div class="calendar-day-headers"><div></div>';
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      weekDates.push(d);
      const isToday = d.toDateString() === today.toDateString();
      html += `<div class="calendar-day-header${isToday ? ' today' : ''}">
        ${dayNames[d.getDay()]}
        <div class="calendar-day-header-date">${d.getDate()}</div>
      </div>`;
    }
    html += '</div><div class="calendar-time-grid">';

    // Time slots (6am to 10pm)
    for (let hour = 6; hour <= 22; hour++) {
      const label = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
      html += `<div class="calendar-time-label">${label}</div>`;
      for (let day = 0; day < 7; day++) {
        const d = weekDates[day];
        let eventHtml = '';
        events.forEach(ev => {
          if (ev.day === d.getDate() && ev.hour === hour && d.getMonth() === today.getMonth()) {
            const height = ev.duration * 48 - 4;
            eventHtml = `<div class="calendar-event" style="background:${ev.color};height:${height}px;top:2px;">${ev.title}</div>`;
          }
        });
        html += `<div class="calendar-time-slot">${eventHtml}</div>`;
      }
    }

    html += '</div>';
    weekView.innerHTML = html;
  }

  renderMini();
  renderWeek();
}
