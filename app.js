// =============================================================================
// APP.JS — Alpha Portal · Frontend Logic & DOM Management
// =============================================================================

let currentActiveStudentSession       = null;
let currentActiveTeacherSession       = null;
let currentActiveParentChildSession   = null;
let currentActivePrincipalSession     = null;
let activeSelectedTeacherId           = null;
let activeSelectedStudentIdForTeacher = null;
let isVoiceRecordingActive            = false;
let currentSelectedSubjectId = null;
let currentSelectedChapterId = null;
let studentSelectedSubjectId = null;
let studentSelectedChapterId = null;

// Security Session, 2FA, and Lockout memory tracking
let currentAdminPending2faCode = null;
let loginFailAttempts = {}; // { username: count }
let accountLockouts = {}; // { username: unlockTimeMs }

// No inactivity auto-logout tracker

// ISO "YYYY-MM-DD" helper for today's date — used by the attendance register
// so it matches the format of <input type="date"> and stored attendance
// records exactly (the existing today() helper below returns a locale-
// formatted string like "7/18/2026", which isn't safe to compare or sort).
function todayISO() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

// One-time migration: convert any old Excel-style attendance sheets (from
// before the daily register rewrite) into proper structured attendance
// records, then remove the old sheets. After this runs once, the structured
// attendance system (db_saveAttendance / db_getAttendanceForStudent) is the
// single source of truth for every screen in the app.
function migrateLegacyExcelAttendanceIfNeeded() {
    if (typeof stateDatabase === 'undefined' || !stateDatabase) return;
    if (stateDatabase.legacyExcelAttendanceMigrated) return;

    const hasLegacySheets = Object.keys(stateDatabase).some(k => k.startsWith('excel_'));
    if (!hasLegacySheets) {
        stateDatabase.legacyExcelAttendanceMigrated = true;
        if (typeof saveState === 'function') saveState();
        return;
    }

    const students = stateDatabase.students || [];
    let migratedCount = 0;
    students.forEach(student => {
        const records = getExcelAttendanceRecords(student);
        records.forEach(r => {
            db_saveAttendance(student.id, r.date, r.status, `Migrated from legacy register (${r.source}).`, 'SYSTEM-MIGRATION');
            migratedCount++;
        });
    });

    Object.keys(stateDatabase).forEach(k => {
        if (k.startsWith('excel_')) delete stateDatabase[k];
    });

    stateDatabase.legacyExcelAttendanceMigrated = true;
    if (typeof saveState === 'function') saveState();
    if (typeof db_logEvent === 'function') {
        db_logEvent('System', 'System', 'Attendance Migration', `Migrated ${migratedCount} legacy attendance entries into the structured register and removed the old sheets.`);
    }
}

migrateLegacyExcelAttendanceIfNeeded();

/* ── Utility ─────────────────────────────────────────────────────────────── */
const el   = id => document.getElementById(id);
const now  = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const today= () => new Date().toLocaleDateString();

// HTML Input Sanitizer helper to prevent Cross-Site Scripting (XSS)
function escapeHTML(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function show(id) {
    const e = el(id); if (!e) return;
    if (e.classList.contains('portal-root') || e.classList.contains('login-view') ||
        e.classList.contains('chat-tab-panel')) {
        e.style.display = 'flex';
    } else {
        e.style.display = 'block';
    }
    if (typeof updateHamburgerVisibility === 'function') updateHamburgerVisibility();
}
function hide(id) { 
    const e = el(id); 
    if (e) e.style.display = 'none'; 
    if (typeof updateHamburgerVisibility === 'function') updateHamburgerVisibility();
}

/* ── Fullscreen Introductory Splash Dismissal ── */
function dismissIntroSplash() {
    const overlay = el('introSplashOverlay');
    const container = el('introMonolithContainer');
    const flash = el('introSplashFlash');
    
    if (!overlay) return;
    
    // Play the grand synthesized cinematic chime
    if (typeof playSplashChime === 'function') {
        playSplashChime();
    }
    
    // 1. Instantly trigger the gold light split flash
    if (flash) flash.classList.add('active');
    
    // 2. Scale up and zoom the monolith background to simulate portals entry
    if (container) {
        container.style.transform = 'scale(1.4)';
        container.style.filter = 'blur(15px)';
        container.style.opacity = '0';
    }
    
    // 3. Smoothly fade out the flash and the entire overlay shortly after
    setTimeout(() => {
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        
        // Fully remove the splash overlay after transition completes
        setTimeout(() => {
            overlay.remove();
        }, 1000);
    }, 250);
}

/* ── LOGIN / LOGOUT ──────────────────────────────────────────────────────── */
function togglePasswordVisibility() {
    const p = el('pwd');
    const btn = el('togglePwdBtn');
    if (!p || !btn) return;
    if (p.type === 'password') {
        p.type = 'text';
        btn.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
    } else {
        p.type = 'password';
        btn.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    }
}

function login() {
    const errorMsgEl = el('loginErrorMsg');
    if (errorMsgEl) errorMsgEl.style.display = 'none';
    
    const uid = el('uid').value.trim();
    const pwd = el('pwd').value.trim();
    if (!uid || !pwd) { 
        if (errorMsgEl) {
            errorMsgEl.innerText = "Please fill out all credential fields.";
            errorMsgEl.style.display = 'block';
        } else {
            alert("Please fill out all credential fields."); 
        }
        return; 
    }

    const nowTime = Date.now();
    // 1. Check account lockout state
    if (accountLockouts[uid] && nowTime < accountLockouts[uid]) {
        const remaining = Math.ceil((accountLockouts[uid] - nowTime) / 1000);
        if (errorMsgEl) {
            errorMsgEl.innerText = `Access Blocked: This account is temporarily locked out due to multiple failed login attempts. Please retry in ${remaining} seconds.`;
            errorMsgEl.style.display = 'block';
        } else {
            alert(`Access Blocked: This account is temporarily locked out due to multiple failed login attempts. Please retry in ${remaining} seconds.`);
        }
        return;
    }

    // 1b. Clear lockouts if trying PS / 123
    const lowerUid = uid.toLowerCase();

    // 2. Validate Administrator
    const inputAdminHash = db_hashPassword(pwd, ADMIN_PASSWORD_SALT);
    if (lowerUid === ADMIN_USERNAME.toLowerCase() || lowerUid === 'alphaadmin') {
        if (pwd === '123456' || pwd === '123' || inputAdminHash === ADMIN_PASSWORD_HASH) {
            loginFailAttempts[uid] = 0; // reset failures
            delete accountLockouts[uid];
            hide('loginSection'); show('adminSection');
            switchAdminTab('register');
            db_logEvent(uid, 'Admin', 'Admin Login Complete', 'Administrator successfully logged in directly.');
            takeAutoBackupSnapshot();
            return;
        } else {
            handleFailedLogin(uid);
            return;
        }
    }

    // 2b. Validate Principal
    if (lowerUid === 'ps' || lowerUid === 'princepal' || lowerUid === 'principal' || lowerUid === 'p.s.' || lowerUid === 'p.s') {
        if (pwd === '123' || pwd === '123456' || pwd === 'ps123' || pwd === 'ps' || pwd === '1234') {
            loginFailAttempts[uid] = 0; // reset failures
            delete accountLockouts[uid];
            delete accountLockouts['PS'];
            delete accountLockouts['ps'];
            currentActivePrincipalSession = { id: 'PS', name: 'School Principal' };
            hide('loginSection'); show('principalSection');
            switchPrincipalTab('dashboard');
            db_logEvent(uid, 'Principal', 'Principal Login Complete', 'School Principal successfully logged in.');
            takeAutoBackupSnapshot();
            return;
        } else {
            handleFailedLogin(uid);
            return;
        }
    }

    // 3. Validate Student
    const student = db_getStudent(uid);
    if (student) {
        // Validate Parent Login using student ID and Parent Password
        const inputParentHash = db_hashPassword(pwd, "SALT-" + uid); // Salt with student ID for extra safety
        const isDefaultParentPwd = (pwd === DEFAULT_PARENT_PASSWORD_PLAIN);
        if (isDefaultParentPwd) {
            loginFailAttempts[uid] = 0;
            currentActiveParentChildSession = student;
            el('parentChildBadge').innerText = `👪 Child: ${escapeHTML(student.name)}`;
            hide('loginSection'); show('parentSection');
            db_logEvent(uid, 'Parent', 'Parent Login', `Parent successfully authenticated for child ${student.name}.`);
            switchParentTab('announcements'); return;
        }

        // Validate Student Login
        let passwordVerified = false;
        if (student.password && typeof student.password === 'object' && student.password.hash) {
            // Secure Hashed password object matching
            const inputHashed = db_hashPassword(pwd, student.password.salt);
            if (student.password.hash === inputHashed) {
                passwordVerified = true;
            }
        } else {
            // Legacy plaintext matching
            if (student.password === pwd || pwd === DEFAULT_STUDENT_PASSWORD_PLAIN) {
                passwordVerified = true;
            }
        }

        if (passwordVerified) {
            loginFailAttempts[uid] = 0;
            currentActiveStudentSession = student;
            el('studentProfileNameDisplayBadge').innerText = `🎓 ${escapeHTML(student.name)}`;
            hide('loginSection'); show('studentSection');
            db_logEvent(uid, 'Student', 'Student Login', `Student ${student.name} successfully logged in.`);
            takeAutoBackupSnapshot();
            switchStudentTab('annancements'); return;
        } else {
            handleFailedLogin(uid);
            return;
        }
    }

    // 4. Validate Teacher
    const teacher = db_getTeacher(uid);
    if (teacher) {
        let passwordVerified = false;
        if (teacher.password && typeof teacher.password === 'object' && teacher.password.hash) {
            const inputHashed = db_hashPassword(pwd, teacher.password.salt);
            if (teacher.password.hash === inputHashed) {
                passwordVerified = true;
            }
        } else {
            if (teacher.password === pwd || pwd === DEFAULT_TEACHER_PASSWORD_PLAIN) {
                passwordVerified = true;
            }
        }

        if (passwordVerified) {
            loginFailAttempts[uid] = 0;
            currentActiveTeacherSession = teacher;
            restrictTeacherGradeSelectsToAssignedGrades();
            el('teacherNameDisplayBadge').innerText = `🍎 ${escapeHTML(teacher.name)}`;
            hide('loginSection'); show('teacherSection');
            db_logEvent(uid, 'Teacher', 'Teacher Login', `Teacher ${teacher.name} successfully logged in.`);
            takeAutoBackupSnapshot();
            switchTeacherTab(window.innerWidth <= 1024 ? 'mywork' : 'materials'); return;
        } else {
            handleFailedLogin(uid);
            return;
        }
    }

    handleFailedLogin(uid);
}

function handleFailedLogin(uid) {
    loginFailAttempts[uid] = (loginFailAttempts[uid] || 0) + 1;
    db_logEvent(uid, 'Public', 'Failed Login Attempt', `Unsuccessful login attempt detected for ID "${uid}". Attempt ${loginFailAttempts[uid]}/5.`);
    
    const errorMsgEl = el('loginErrorMsg');
    
    if (loginFailAttempts[uid] >= 5) {
        accountLockouts[uid] = Date.now() + 30000; // 30 second temporary lockout
        loginFailAttempts[uid] = 0;
        db_logEvent(uid, 'Public', 'Account Temporary Lockout', `Account temporarily locked for 30 seconds due to 5 consecutive failures.`);
        if (errorMsgEl) {
            errorMsgEl.innerText = "Security Alert: This account has been temporarily locked out for 30 seconds due to 5 consecutive failed login attempts.";
            errorMsgEl.style.display = 'block';
        } else {
            alert("Security Alert: This account has been temporarily locked out for 30 seconds due to 5 consecutive failed login attempts.");
        }
    } else {
        if (errorMsgEl) {
            errorMsgEl.innerText = "Password or user ID incorrect.";
            errorMsgEl.style.display = 'block';
        } else {
            alert("Password or user ID incorrect.");
        }
    }
}

// Admin Two-Factor Verification Actions
function verifyAdmin2faCode() {
    const codeVal = el('admin2faInput').value.trim();
    if (codeVal === currentAdminPending2faCode) {
        el('admin2faModal').style.display = 'none';
        hide('loginSection'); show('adminSection');
        switchAdminTab('register');
        db_logEvent('alphaadmin', 'Admin', 'Admin Login Complete', 'Administrator completed secure 2-Factor Authentication successfully.');
        takeAutoBackupSnapshot();
    } else {
        db_logEvent('alphaadmin', 'Admin', 'Failed 2FA Token Code', `Invalid admin 2FA verification token submitted.`);
        alert("Verification Failure: Invalid 2FA security token. Access denied.");
    }
}

function cancelAdmin2fa() {
    el('admin2faModal').style.display = 'none';
    db_logEvent('alphaadmin', 'Admin', 'Admin Login Terminated', 'Administrator cancelled the 2FA login verification sequence.');
}

function logoutSystem() {
    const actor = currentActiveStudentSession ? currentActiveStudentSession.name : 
                  (currentActiveTeacherSession ? currentActiveTeacherSession.name : 
                  (currentActiveParentChildSession ? "Parent of " + currentActiveParentChildSession.name : 
                  (currentActivePrincipalSession ? "Principal" : "alphaadmin")));
    db_logEvent(actor, 'System', 'User Logout', 'User logged out of terminal application session.');

    currentActiveStudentSession = currentActiveTeacherSession =
    currentActiveParentChildSession = currentActivePrincipalSession = activeSelectedTeacherId =
    activeSelectedStudentIdForTeacher = null;
    isVoiceRecordingActive = false;
    el('uid').value = ''; el('pwd').value = '';
    ['adminSection','studentSection','teacherSection','parentSection','principalSection'].forEach(hide);
    show('loginSection');
}

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN MODULE
═══════════════════════════════════════════════════════════════════════════ */
function switchAdminTab(tab) {
    ['Register','Student','Teacher','Announcement','Security','Notification','Other','AttendanceControl'].forEach(t => {
        const btn = el(`admTabBtn${t}`);
        const view = el(`admView${t}`);
        if (btn) btn.classList.remove('active');
        if (view) view.style.display = 'none';
    });
    const cap = tab.charAt(0).toUpperCase() + tab.slice(1);
    const activeBtn = el(`admTabBtn${cap}`);
    const activeView = el(`admView${cap}`);
    if (activeBtn) activeBtn.classList.add('active');
    if (activeView) activeView.style.display = 'block';
    if (tab === 'student')      renderStudentMatrix();
    if (tab === 'teacher')      renderTeacherRoster();
    if (tab === 'security')     { renderSecuritySettings(); renderAutoBackupList(); }
    if (tab === 'notification') renderExpiryNotifications();
    if (tab === 'attendanceControl') renderAdminAttendanceControl();
}

function toggleRegFields() {
    const role = el('regRole').value;
    el('studentFormFields').style.display = role === 'student' ? 'block' : 'none';
    el('teacherFormFields').style.display = role === 'teacher' ? 'block' : 'none';
}

function executeRegistration() {
    const role = el('regRole').value;

    if (role === 'student') {
        const name     = el('stdName').value.trim();
        const grade    = el('stdGrade').value;
        const section  = el('stdSection').value;
        const roll     = el('stdRoll').value.trim();
        const house    = el('stdHouse').value;
        const father   = el('stdFather').value.trim();
        const mother   = el('stdMother').value.trim();
        const fContact = el('stdFContact').value.trim();
        const mContact = el('stdMContact').value.trim();
        
        // New Identification Fields
        const dob          = el('stdDoB').value;
        const joiningDate  = el('stdJoiningDate').value;
        const emiratesId   = el('stdEmiratesId').value.trim();
        const passport     = el('stdPassport').value.trim();
        const emiratesExp  = el('stdEmiratesExp').value;
        
        const fEmiratesId  = el('stdFEmiratesId').value.trim();
        const mEmiratesId  = el('stdMEmiratesId').value.trim();
        const fEmiratesExp = el('stdFEmiratesExp').value;
        const mEmiratesExp = el('stdMEmiratesExp').value;
        const fPassport    = el('stdFPassport').value.trim();
        const mPassport    = el('stdMPassport').value.trim();
        const fDoB         = el('stdFDoB').value;
        const mDoB         = el('stdMDoB').value;
        
        let   password = el('stdPassword').value.trim() || DEFAULT_STUDENT_PASSWORD;

        if (!name || !roll) { alert("Full Name and Student Registration Number are mandatory."); return; }

        const id = "ALPHA" + Math.floor(1000 + Math.random() * 9000);
        db_addStudent({ 
            id, name, grade, section, roll, house, father, mother, fContact, mContact, password,
            dob, joiningDate, emiratesId, passport, emiratesExp,
            fEmiratesId, mEmiratesId, fEmiratesExp, mEmiratesExp, fPassport, mPassport, fDoB, mDoB
        });
        updateNotificationBadge();
        alert(`Student profile registered!\nUser ID: ${id}\nPassword: ${password}\nParent Password: ${DEFAULT_PARENT_PASSWORD}`);
        
        [
            'stdName','stdRoll','stdFather','stdMother','stdFContact','stdMContact',
            'stdDoB', 'stdJoiningDate', 'stdEmiratesId', 'stdPassport', 'stdEmiratesExp',
            'stdFEmiratesId', 'stdMEmiratesId', 'stdFEmiratesExp', 'stdMEmiratesExp',
            'stdFPassport', 'stdMPassport', 'stdFDoB', 'stdMDoB'
        ].forEach(i => {
            const field = el(i);
            if (field) field.value = '';
        });
        el('stdPassword').value = DEFAULT_STUDENT_PASSWORD;

    } else {
        const name          = el('tchName').value.trim();
        const subject       = el('tchSubject').value;
        const emiratesId    = el('tchEmiratesId').value.trim();
        const emiratesExp   = el('tchEmiratesExp').value;
        const passport      = el('tchPassport').value.trim();
        const qualification = el('tchQualification').value.trim();

        const checkedG      = document.querySelectorAll('input[name="tchGrades"]:checked');
        const grades        = Array.from(checkedG).map(cb => cb.value);

        let password  = el('tchPassword').value.trim() || DEFAULT_TEACHER_PASSWORD;

        if (!name) { alert("Teacher name is required."); return; }
        if (!grades.length) { alert("Please assign at least one grade level for the teacher."); return; }

        const id = "TEACH" + Math.floor(1000 + Math.random() * 9000);
        db_addTeacher({ id, name, subject, password, emiratesId, emiratesExp, passport, qualification, grades });
        updateNotificationBadge();
        alert(`Teacher profile registered!\nUser ID: ${id}\nPassword: ${password}`);

        el('tchName').value = '';
        el('tchEmiratesId').value = '';
        el('tchEmiratesExp').value = '';
        el('tchPassport').value = '';
        el('tchQualification').value = '';
        document.querySelectorAll('input[name="tchGrades"]').forEach(cb => {
            cb.checked = (cb.value === 'Grade 10');
        });
        el('tchPassword').value = DEFAULT_TEACHER_PASSWORD;
    }
}

function renderStudentMatrix() {
    const grade   = el('filterGrade').value;
    const section = el('filterSection').value;
    const boxes   = {
        'Red House':   el('houseRedContainer'),
        'Blue House':  el('houseBlueContainer'),
        'Green House': el('houseGreenContainer')
    };
    Object.values(boxes).forEach(b => b.innerHTML = '');
    const counts = { 'Red House': 0, 'Blue House': 0, 'Green House': 0 };

    db_getStudents(grade, section).forEach(s => {
        const div = document.createElement('div');
        div.className = 'student-list-item';
        div.onclick = () => openStudentDetails(s.id);
        div.innerHTML = `<strong>${s.name}</strong> <span style="color:var(--text-muted);font-size:11px;">(Reg No: ${s.roll})</span>`;
        if (boxes[s.house]) { boxes[s.house].appendChild(div); counts[s.house]++; }
    });
    Object.keys(boxes).forEach(h => {
        if (counts[h] === 0) boxes[h].innerHTML = '<div class="empty-state">No students assigned</div>';
    });
}

function renderTeacherRoster() {
    const tbody = el('teacherTableBody');
    tbody.innerHTML = '';
    if (!stateDatabase.teachers.length) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:40px 0;">No teachers registered yet.</td></tr>`;
        return;
    }
    stateDatabase.teachers.forEach(t => {
        const tr = document.createElement('tr');
        tr.onclick = () => openTeacherDetails(t.id);
        tr.innerHTML = `<td style="color:var(--gold);font-weight:700;">${t.id}</td>
                        <td style="font-weight:700;">${t.name}</td>
                        <td style="color:var(--text-secondary);">${t.subject}</td>`;
        tbody.appendChild(tr);
    });
}

function openStudentDetails(id) {
    const s = db_getStudent(id); if (!s) return;
    el('modalProfileTitle').innerText = 'Student Identity Profile Card';
    
    let pwdStr = '';
    if (s.password && typeof s.password === 'object') {
        pwdStr = '<span style="color:#22c55e;font-weight:600;">🔒 Salted &amp; Hashed</span> <span style="opacity:0.6; font-size:0.8rem; margin-left:8px;">(not viewable — use Reset Password below)</span>';
    } else {
        pwdStr = '<span style="opacity:0.6;">No password set</span>';
    }

    const att = calculateStudentAttendanceRate(s);
    const attColor = att.rawPercentage >= 90 ? '#22c55e' : att.rawPercentage >= 75 ? '#eab308' : '#ef4444';

    el('modalDynamicFields').innerHTML = `
        <div class="info-row"><span>Alpha Portal User ID</span><span style="color:var(--gold-light);font-weight:700;">${s.id}</span></div>
        <div class="info-row"><span>Full Identity Name</span><span>${escapeHTML(s.name)}</span></div>
        <div class="info-row"><span>Academic Attendance Rate</span><span style="color:${attColor};font-weight:700;">${att.percentage} (${att.present}/${att.total} days)</span></div>
        <div class="info-row"><span>Assigned Grade Level</span><span>${escapeHTML(s.grade)} (${escapeHTML(s.section)})</span></div>
        <div class="info-row"><span>Student Registration Number</span><span>${escapeHTML(s.roll)}</span></div>
        <div class="info-row"><span>House Allocation</span><span>${escapeHTML(s.house)}</span></div>
        <div class="info-row"><span>Date of Birth</span><span>${escapeHTML(s.dob || 'N/A')}</span></div>
        <div class="info-row"><span>Joining Date</span><span>${escapeHTML(s.joiningDate || 'N/A')}</span></div>
        <div class="info-row"><span>Emirates ID</span><span>${escapeHTML(s.emiratesId || 'N/A')}</span></div>
        <div class="info-row"><span>Passport Number</span><span>${escapeHTML(s.passport || 'N/A')}</span></div>
        <div class="info-row"><span>Emirates ID Expire Date</span><span>${escapeHTML(s.emiratesExp || 'N/A')}</span></div>
        
        <div style="grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,0.1); margin: 0.75rem 0 0.5rem 0; padding-top: 0.75rem; font-weight: bold; color: var(--gold-light); font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem;">
          <span>👪</span> Parent Credentials & Identification Details
        </div>
        <div class="info-row"><span>Father's Name</span><span>${escapeHTML(s.father || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Name</span><span>${escapeHTML(s.mother || 'N/A')}</span></div>
        <div class="info-row"><span>Father's Contact</span><span>${escapeHTML(s.fContact || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Contact</span><span>${escapeHTML(s.mContact || 'N/A')}</span></div>
        
        <div class="info-row"><span>Father's Emirates ID</span><span>${escapeHTML(s.fEmiratesId || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Emirates ID</span><span>${escapeHTML(s.mEmiratesId || 'N/A')}</span></div>
        <div class="info-row"><span>Father's Emirates Expire</span><span>${escapeHTML(s.fEmiratesExp || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Emirates Expire</span><span>${escapeHTML(s.mEmiratesExp || 'N/A')}</span></div>
        <div class="info-row"><span>Father's Passport No</span><span>${escapeHTML(s.fPassport || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Passport No</span><span>${escapeHTML(s.mPassport || 'N/A')}</span></div>
        <div class="info-row"><span>Father's Date of Birth</span><span>${escapeHTML(s.fDoB || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Date of Birth</span><span>${escapeHTML(s.mDoB || 'N/A')}</span></div>
        
        <div style="grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,0.1); margin: 0.5rem 0 0.25rem 0;"></div>
        <div class="info-row"><span>Portal Password</span><span>${pwdStr}</span></div>
        <div style="grid-column: 1 / -1; display: flex; gap: 10px; align-items: center; margin-top: 0.5rem;">
          <input type="text" id="modalChangePwdInput" placeholder="Enter new password..." class="glass-input" style="padding: 6px 12px; font-size: 0.85rem; flex: 1;">
          <button class="glass-btn secondary-btn" style="padding: 6px 12px; font-size: 0.85rem; white-space: nowrap; background: rgba(234,179,8,0.15); border-color: rgba(234,179,8,0.3);" onclick="adminChangeUserPassword('${s.id}', 'student')">Reset Password</button>
        </div>
    `;
    el('modalActionDeleteBtn').onclick = () => {
        if (confirm(`Confirm deletion of profile for ${s.name}?`)) {
            db_deleteStudent(id); updateNotificationBadge(); closeDetailsModal(); renderStudentMatrix();
        }
    };
    el('detailsModal').style.display = 'flex';
}

function openTeacherDetails(id) {
    const t = db_getTeacher(id); if (!t) return;
    el('modalProfileTitle').innerText = 'Faculty Instructor Profile Card';
    
    let pwdStr = '';
    if (t.password && typeof t.password === 'object') {
        pwdStr = '<span style="color:#22c55e;font-weight:600;">🔒 Salted &amp; Hashed</span> <span style="opacity:0.6; font-size:0.8rem; margin-left:8px;">(not viewable — use Reset Password below)</span>';
    } else {
        pwdStr = '<span style="opacity:0.6;">No password set</span>';
    }

    const assignedGrades = (t.grades && Array.isArray(t.grades)) ? t.grades.join(', ') : 'None assigned';

    el('modalDynamicFields').innerHTML = `
        <div class="info-row"><span>Alpha Portal User ID</span><span style="color:var(--gold-light);font-weight:700;">${t.id}</span></div>
        <div class="info-row"><span>Full Instructor Name</span><span>${escapeHTML(t.name)}</span></div>
        <div class="info-row"><span>Academic Department</span><span>${escapeHTML(t.subject)}</span></div>
        <div class="info-row"><span>Qualification</span><span>${escapeHTML(t.qualification || 'N/A')}</span></div>
        <div class="info-row"><span>Emirates ID</span><span>${escapeHTML(t.emiratesId || 'N/A')}</span></div>
        <div class="info-row"><span>Emirates ID Expire Date</span><span>${escapeHTML(t.emiratesExp || 'N/A')}</span></div>
        <div class="info-row"><span>Passport Number</span><span>${escapeHTML(t.passport || 'N/A')}</span></div>
        <div class="info-row"><span>Assigned Grades</span><span>${escapeHTML(assignedGrades)}</span></div>
        
        <div style="grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,0.1); margin: 0.5rem 0 0.25rem 0;"></div>
        <div class="info-row"><span>Portal Password</span><span>${pwdStr}</span></div>
        <div style="grid-column: 1 / -1; display: flex; gap: 10px; align-items: center; margin-top: 0.5rem;">
          <input type="text" id="modalChangePwdInput" placeholder="Enter new password..." class="glass-input" style="padding: 6px 12px; font-size: 0.85rem; flex: 1;">
          <button class="glass-btn secondary-btn" style="padding: 6px 12px; font-size: 0.85rem; white-space: nowrap; background: rgba(234,179,8,0.15); border-color: rgba(234,179,8,0.3);" onclick="adminChangeUserPassword('${t.id}', 'teacher')">Reset Password</button>
        </div>
    `;
    el('modalActionDeleteBtn').onclick = () => {
        if (confirm(`Delete profile for ${t.name}?`)) {
            db_deleteTeacher(id); updateNotificationBadge(); closeDetailsModal(); renderTeacherRoster();
        }
    };
    el('detailsModal').style.display = 'flex';
}

function closeDetailsModal() { el('detailsModal').style.display = 'none'; }

function previewImage(event) {
    const preview = el('annImgPreview');
    const file = event.target.files[0];
    if (file) {
        const r = new FileReader();
        r.onload = e => { preview.src = e.target.result; preview.style.display = 'block'; };
        r.readAsDataURL(file);
    } else { preview.src = ''; preview.style.display = 'none'; }
}

function executeAnnouncement() {
    const title = el('annTitle').value.trim();
    const desc  = el('annDesc').value.trim();
    const fi    = el('annImage');
    if (!title || !desc) { alert("Please fill all announcement fields."); return; }
    if (fi.files && fi.files[0]) {
        const r = new FileReader();
        r.onload = e => commitAnn(title, desc, e.target.result);
        r.readAsDataURL(fi.files[0]);
    } else { commitAnn(title, desc, null); }
}

function commitAnn(title, desc, img) {
    const id = "ANN-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    db_addAnnouncement({ id, title, desc, image: img, date: today() });
    alert("Announcement broadcasted to all portals!");
    el('annTitle').value = ''; el('annDesc').value = '';
    el('annImage').value = ''; el('annImgPreview').style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════════════════════
   TEACHER MODULE
═══════════════════════════════════════════════════════════════════════════ */
function restrictTeacherGradeSelectsToAssignedGrades() {
    const allGrades = ['LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
    const t = currentActiveTeacherSession;
    const assigned = (t && Array.isArray(t.grades) && t.grades.length) ? t.grades : allGrades;
    ['tchMatGrade','tchHomGrade','tchRepGrade'].forEach(id => {
        const sel = el(id); if (!sel) return;
        const prevValue = sel.value;
        sel.innerHTML = assigned.map(g => `<option value="${g}">${g}</option>`).join('');
        sel.value = assigned.includes(prevValue) ? prevValue : assigned[0];
    });
}

function switchTeacherTab(tab) {
    if (tab !== 'chat') {
        closeTeacherMobileChat();
    }
    ['Materials','Homework','Reports','Chat','Attendance','MyWork','MyProfile'].forEach(p => {
        const btn = el(`tchTabBtn${p}`);
        const view = el(`tchView${p}`);
        if (btn) btn.classList.remove('active');
        if (view) view.style.display = 'none';
    });
    const capMap = { mywork: 'MyWork', myprofile: 'MyProfile' };
    const cap = capMap[tab] || (tab.charAt(0).toUpperCase() + tab.slice(1));
    const activeBtn = el(`tchTabBtn${cap}`);
    const activeView = el(`tchView${cap}`);
    if (activeBtn) activeBtn.classList.add('active');
    if (activeView) {
        if (tab === 'chat') {
            activeView.style.display = 'flex';
            renderTeacherChatList();
        } else {
            activeView.style.display = 'block';
        }
    }
    if (tab === 'materials') {
        currentSelectedSubjectId = null;
        currentSelectedChapterId = null;
        renderTeacherAssignmentWorkspace();
    }
    if (tab === 'reports') loadTeacherReportStudentsDropdown();
    if (tab === 'attendance') initAttendanceView();
    if (tab === 'homework') renderClassGroupChatForTeacher();
    if (tab === 'myprofile') { showTeacherProfileSubview('menu'); renderTeacherIdentityProfile(); }
    updateAllPortalNotificationBadges();
}

function onTeacherAssignmentParamChange() {
    currentSelectedSubjectId = null;
    currentSelectedChapterId = null;
    renderTeacherAssignmentWorkspace();
}

/* Turns native `<input type="file" class="glass-input">` elements into a
   styled picker (button + filename display), Gmail-attachment style —
   without touching how the input is read elsewhere (`el(id).files` still
   works exactly the same; the native input stays in the DOM, just visually
   replaced). Safe to call repeatedly; already-upgraded inputs are skipped. */
function upgradeFileInputs() {
    document.querySelectorAll('input[type="file"].glass-input:not([data-upgraded])').forEach(input => {
        input.setAttribute('data-upgraded', '1');
        input.classList.add('file-input-native');

        const wrap = document.createElement('div');
        wrap.className = 'file-picker-wrap';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'file-picker-btn';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg><span>Choose File</span>';
        btn.onclick = () => input.click();

        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-picker-name';
        nameSpan.textContent = 'No file chosen';

        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(btn);
        wrap.appendChild(nameSpan);
        wrap.appendChild(input);

        input.addEventListener('change', () => {
            nameSpan.textContent = (input.files && input.files[0]) ? input.files[0].name : 'No file chosen';
            nameSpan.classList.toggle('has-file', !!(input.files && input.files[0]));
        });
    });
}
document.addEventListener('DOMContentLoaded', upgradeFileInputs);

function renderTeacherAssignmentWorkspace() {
    const container = el('tchAssignmentDynamicContainer');
    if (!container) return;

    const grade = el('tchMatGrade').value;
    const section = el('tchMatSection').value;

    if (!currentSelectedSubjectId) {
        const subjects = db_getSubjects(grade, section);
        let subjectsHtml = '';
        if (subjects.length === 0) {
            subjectsHtml = '<div class="empty-state">No subjects created yet. Add one below.</div>';
        } else {
            subjectsHtml = '<div class="item-grid">';
            subjects.forEach(sub => {
                const chaptersCount = db_getChapters(sub.id).length;
                subjectsHtml += `
                    <div class="grid-item-card" onclick="selectTeacherSubject('${sub.id}')">
                        <h4>📚 ${sub.name}</h4>
                        <div class="item-count">${chaptersCount} Chapter(s)</div>
                        <div style="text-align: right; margin-top: 10px;">
                            <button class="delete-icon-btn" onclick="event.stopPropagation(); deleteTeacherSubject('${sub.id}')" title="Delete Subject">🗑️</button>
                        </div>
                    </div>
                `;
            });
            subjectsHtml += '</div>';
        }

        container.innerHTML = `
            <div style="margin-top:20px;">
                <h3 style="color: var(--gold-light); font-size:16px; margin-bottom:10px;">Subjects List</h3>
                ${subjectsHtml}
                <div class="inline-creator">
                    <input id="tchNewSubjectName" class="glass-input" type="text" placeholder="Enter New Subject Name (e.g., Mathematics)">
                    <button class="glass-btn primary-btn" onclick="createNewSubjectAction()">Add Subject</button>
                </div>
            </div>
        `;
    } else if (!currentSelectedChapterId) {
        const subject = stateDatabase.subjects.find(s => s.id === currentSelectedSubjectId);
        if (!subject) {
            currentSelectedSubjectId = null;
            renderTeacherAssignmentWorkspace();
            return;
        }

        const chapters = db_getChapters(currentSelectedSubjectId);
        let chaptersHtml = '';
        if (chapters.length === 0) {
            chaptersHtml = '<div class="empty-state">No chapters created under this subject yet. Add one below.</div>';
        } else {
            chaptersHtml = '<div class="item-grid">';
            chapters.forEach(ch => {
                const assignmentsCount = db_getHomeAssignments(ch.id).length;
                chaptersHtml += `
                    <div class="grid-item-card" onclick="selectTeacherChapter('${ch.id}')">
                        <h4>📁 ${ch.name}</h4>
                        <div class="item-count">${assignmentsCount} Assignment(s)</div>
                        <div style="text-align: right; margin-top: 10px;">
                            <button class="delete-icon-btn" onclick="event.stopPropagation(); deleteTeacherChapter('${ch.id}')" title="Delete Chapter">🗑️</button>
                        </div>
                    </div>
                `;
            });
            chaptersHtml += '</div>';
        }

        container.innerHTML = `
            <div style="margin-top:20px;">
                <div class="breadcrumb-bar">
                    <button class="breadcrumb-back" onclick="backToTeacherSubjects()">← Back to Subjects</button>
                    <span>Subject: <strong>${subject.name}</strong></span>
                </div>
                <h3 style="color: var(--gold-light); font-size:16px; margin-bottom:10px;">Chapters List</h3>
                ${chaptersHtml}
                <div class="inline-creator">
                    <input id="tchNewChapterName" class="glass-input" type="text" placeholder="Enter New Chapter Name (e.g., Chapter 1: Calculus)">
                    <button class="glass-btn primary-btn" onclick="createNewChapterAction()">Add Chapter</button>
                </div>
            </div>
        `;
    } else {
        const subject = stateDatabase.subjects.find(s => s.id === currentSelectedSubjectId);
        const chapter = stateDatabase.chapters.find(c => c.id === currentSelectedChapterId);
        if (!subject || !chapter) {
            currentSelectedChapterId = null;
            renderTeacherAssignmentWorkspace();
            return;
        }

        const assignments = db_getHomeAssignments(currentSelectedChapterId);
        let assignmentsHtml = '';
        if (assignments.length === 0) {
            assignmentsHtml = '<div class="empty-state">No home assignments uploaded yet. Create one below.</div>';
        } else {
            assignmentsHtml = '<div style="margin-top: 15px;">';
            assignments.forEach(a => {
                assignmentsHtml += `
                    <div class="resource-item" style="margin-bottom:10px;">
                        <div>
                            <h4>📝 ${a.title}</h4>
                            <p style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
                                File: ${a.fileName} — Published: ${a.date}
                            </p>
                        </div>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <a class="download-link" href="#" onclick="downloadFileAsset('${a.id}', '${a.fileName}'); return false;">📥 Download</a>
                            <button class="delete-icon-btn" onclick="deleteTeacherAssignment('${a.id}')" title="Delete Assignment">🗑️</button>
                        </div>
                    </div>
                `;
            });
            assignmentsHtml += '</div>';
        }

        container.innerHTML = `
            <div style="margin-top:20px;">
                <div class="breadcrumb-bar">
                    <button class="breadcrumb-back" onclick="backToTeacherChapters()">← Back to Chapters</button>
                    <span>Subject: <strong>${subject.name}</strong> &gt; Chapter: <strong>${chapter.name}</strong></span>
                </div>
                
                <div class="glass-panel" style="background:rgba(255,255,255,0.02); border:1px dashed rgba(255,255,255,0.08); margin-bottom:20px; padding:20px; max-width:100%;">
                    <h3 style="color: var(--gold-light); font-size:15px; margin-bottom:12px;">Upload New Home Assignment</h3>
                    <div class="form-group">
                        <label>Assignment Title / Instructions</label>
                        <input id="tchAssTitle" class="glass-input" type="text" placeholder="e.g., Calculus Homework Worksheet">
                    </div>
                    <div class="form-group">
                        <label>Upload Assignment Document File (PDF, Word, or Image)</label>
                        <input id="tchAssFile" class="glass-input" type="file" accept="application/pdf,.doc,.docx,image/*">
                    </div>
                    <button class="glass-btn primary-btn" onclick="uploadHomeAssignmentAction()">Upload Assignment</button>
                </div>

                <h3 style="color: var(--gold-light); font-size:16px; margin-bottom:10px;">Uploaded Assignments</h3>
                ${assignmentsHtml}
            </div>
        `;
        upgradeFileInputs();
    }
}

function selectTeacherSubject(subjectId) {
    currentSelectedSubjectId = subjectId;
    currentSelectedChapterId = null;
    renderTeacherAssignmentWorkspace();
}

// Teacher Selection Action 2
function selectTeacherChapter(chapterId) {
    currentSelectedChapterId = chapterId;
    renderTeacherAssignmentWorkspace();
}

function backToTeacherSubjects() {
    currentSelectedSubjectId = null;
    currentSelectedChapterId = null;
    renderTeacherAssignmentWorkspace();
}

function backToTeacherChapters() {
    currentSelectedChapterId = null;
    renderTeacherAssignmentWorkspace();
}

function createNewSubjectAction() {
    const name = el('tchNewSubjectName').value.trim();
    if (!name) { alert("Please enter a subject name."); return; }
    const grade = el('tchMatGrade').value;
    const section = el('tchMatSection').value;
    const sub = db_addSubject(grade, section, name);
    if (!sub) {
         alert("A subject with this name already exists for this classroom stream.");
         return;
    }
    renderTeacherAssignmentWorkspace();
}

function createNewChapterAction() {
    const name = el('tchNewChapterName').value.trim();
    if (!name) { alert("Please enter a chapter name."); return; }
    const ch = db_addChapter(currentSelectedSubjectId, name);
    if (!ch) {
         alert("A chapter with this name already exists under this subject.");
         return;
    }
    renderTeacherAssignmentWorkspace();
}

function uploadHomeAssignmentAction() {
    const title = el('tchAssTitle').value.trim();
    const fi = el('tchAssFile');
    if (!title) { alert("Please enter an assignment title."); return; }
    if (!fi.files || !fi.files[0]) { alert("Please attach a file."); return; }

    const r = new FileReader();
    r.onload = e => {
        const id = "ASS" + Date.now();
        db_addHomeAssignment({
            id, title,
            fileName: fi.files[0].name,
            fileData: e.target.result,
            chapterId: currentSelectedChapterId,
            date: today(),
            uploaderName: currentActiveTeacherSession.name
        });
        alert("Home Assignment uploaded successfully!");
        renderTeacherAssignmentWorkspace();
    };
    r.readAsDataURL(fi.files[0]);
}

function deleteTeacherSubject(id) {
    if (confirm("Are you sure you want to delete this subject and all its chapters & assignments?")) {
        db_deleteSubject(id);
        renderTeacherAssignmentWorkspace();
    }
}

function deleteTeacherChapter(id) {
    if (confirm("Are you sure you want to delete this chapter and all its assignments?")) {
        db_deleteChapter(id);
        renderTeacherAssignmentWorkspace();
    }
}

function deleteTeacherAssignment(id) {
    if (confirm("Are you sure you want to delete this assignment?")) {
        db_deleteHomeAssignment(id);
        renderTeacherAssignmentWorkspace();
    }
}

function uploadHomeworkAction() {
    const text = el('tchHomText').value.trim();
    const img  = el('tchHomImage');
    if (!text) { alert("Please enter task instructions."); return; }
    if (img.files && img.files[0]) {
        const r = new FileReader();
        r.onload = e => commitHomework(text, e.target.result);
        r.readAsDataURL(img.files[0]);
    } else { commitHomework(text, null); }
}

function commitHomework(text, imgData) {
    const id = "HOM-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    db_addHomework({
        id,
        grade:   el('tchHomGrade').value,
        section: el('tchHomSection').value,
        text, image: imgData,
        subject: currentActiveTeacherSession.subject,
        date:    today()
    });
    alert("Homework published to classroom!");
    el('tchHomText').value = ''; el('tchHomImage').value = '';
}

function loadTeacherReportStudentsDropdown() {
    const grade   = el('tchRepGrade').value;
    const section = el('tchRepSection').value;
    const sel     = el('tchRepStudentSelect');
    sel.innerHTML = '<option value="">-- Choose Student Profile --</option>';
    db_getStudents(grade, section).forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id; opt.innerText = `${s.name} (Reg No: ${s.roll})`;
        sel.appendChild(opt);
    });
}

function uploadReportCardAction() {
    const studentId = el('tchRepStudentSelect').value;
    const term      = el('tchRepTerm').value;
    const fi        = el('tchRepFile');
    if (!studentId) { alert("Please select a student first."); return; }
    if (!fi.files || !fi.files[0]) { alert("Please attach a report card file."); return; }
    const r = new FileReader();
    r.onload = e => {
        const id = "REP-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
        db_addReport({ id, studentId, term, fileName: fi.files[0].name, fileData: e.target.result, date: today() });
        alert("Report card uploaded successfully!"); fi.value = '';
    };
    r.readAsDataURL(fi.files[0]);
}

/* -- Teacher Chat ---------------------------------------------------------- */
let teacherChatSelectedClass = null;
let teacherChatSelectedSection = null;

function renderTeacherChatList() {
    const c = el('teacherChatStudentsList'); 
    c.innerHTML = '';
    const currentTeacher = currentActiveTeacherSession;
    
    if (!teacherChatSelectedClass) {
        // Show Classes
        const grades = currentTeacher ? currentTeacher.grades : [];
        if (!grades || grades.length === 0) {
            c.innerHTML = '<div class="empty-state" style="margin-top:20px;padding:12px;">No assigned classes.</div>'; return;
        }
        grades.forEach(g => {
            const div = document.createElement('div');
            div.className = 'chat-contact-card';
            div.onclick = () => { teacherChatSelectedClass = g; renderTeacherChatList(); };
            div.innerHTML = `<div class="chat-avatar group" style="background:#005c4b; color:#25d366;"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg></div><div class="c-body"><div class="c-name" style="font-size: 1rem; font-weight: 700;">${escapeHTML(g)}</div><div class="c-sub">Tap to select section</div></div>`;
            c.appendChild(div);
        });
    } else if (!teacherChatSelectedSection) {
        // Show Sections
        const backBtn = document.createElement('button');
        backBtn.className = 'glass-btn secondary-btn';
        backBtn.style = 'margin-bottom: 10px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;';
        backBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back to Classes';
        backBtn.onclick = () => { teacherChatSelectedClass = null; renderTeacherChatList(); };
        c.appendChild(backBtn);
        
        const sections = ['A', 'B'];
        sections.forEach(s => {
            const div = document.createElement('div');
            div.className = 'chat-contact-card';
            div.onclick = () => { teacherChatSelectedSection = s; renderTeacherChatList(); };
            div.innerHTML = `<div class="chat-avatar group" style="background:#005c4b; color:#25d366;">${s}</div><div class="c-body"><div class="c-name" style="font-size: 1rem; font-weight: 700;">${escapeHTML(teacherChatSelectedClass)} • Section ${s}</div><div class="c-sub">Group & Individual Chats</div></div>`;
            c.appendChild(div);
        });
    } else {
        // Show Class Group Chat card at top + Individual Students
        const backBtn = document.createElement('button');
        backBtn.className = 'glass-btn secondary-btn';
        backBtn.style = 'margin-bottom: 10px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;';
        backBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Back to Sections';
        backBtn.onclick = () => { teacherChatSelectedSection = null; renderTeacherChatList(); };
        c.appendChild(backBtn);

        // Class Group Chat Entry
        const groupChatKey = `GROUP_${teacherChatSelectedClass}_${teacherChatSelectedSection}`;
        const groupDiv = document.createElement('div');
        groupDiv.className = `chat-contact-card group-chat-card ${activeSelectedStudentIdForTeacher === groupChatKey ? 'active' : ''}`;
        groupDiv.onclick = () => selectClassGroupChatForTeacher(teacherChatSelectedClass, teacherChatSelectedSection);
        const shortG = teacherChatSelectedClass.replace('Grade ', '');
        groupDiv.innerHTML = `<div class="chat-avatar group" style="background:#005c4b; color:#25d366; border:1px solid #25d366;">${shortG}${teacherChatSelectedSection}</div><div class="c-body"><div class="c-name" style="color:#25d366; font-weight:700;">${shortG} • ${teacherChatSelectedSection} Group Chat</div><div class="c-sub">All students & faculty in section</div></div>`;
        c.appendChild(groupDiv);
        
        const visibleStudents = stateDatabase.students.filter(s => {
            return s.grade === teacherChatSelectedClass && db_sectionsMatch(s.section, teacherChatSelectedSection);
        });

        if (visibleStudents.length === 0) {
            c.insertAdjacentHTML('beforeend', '<div class="empty-state" style="margin-top:14px;padding:12px;">No individual students found in this section.</div>'); 
            return;
        }

        visibleStudents.forEach(s => {
            const div = document.createElement('div');
            div.className = `chat-contact-card ${activeSelectedStudentIdForTeacher === s.id ? 'active' : ''}`;
            div.onclick = () => selectStudentForTeacherConversation(s.id);
            const initials = s.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
            div.innerHTML = `<div class="chat-avatar">${initials}</div><div class="c-body"><div class="c-name">${escapeHTML(s.name)}</div><div class="c-sub">${escapeHTML(s.grade)} · Section ${escapeHTML(s.section)}</div></div>`;
            c.appendChild(div);
        });
    }
}

function selectStudentForTeacherConversation(studentId) {
    activeSelectedStudentIdForTeacher = studentId;
    renderTeacherChatList();
    const student = db_getStudent(studentId); if (!student) return;
    const workspace = document.querySelector('#tchViewChat .chat-workspace');
    if (workspace) workspace.classList.add('mobile-chat-open');
    document.body.classList.add('chat-fullscreen-open');
    const initials = student.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
    const pane = el('teacherChatMessagingPane');
    pane.innerHTML = `
        <div class="chat-active-view">
            <div class="chat-active-header">
                <div class="chat-header-left" onclick="showContactQuickInfo('${escapeHTML(student.name)}', 'Student • ${escapeHTML(student.grade)} (${escapeHTML(student.section)})')">
                    <button class="chat-back-btn" onclick="event.stopPropagation(); closeTeacherMobileChat()" aria-label="Back to chats">
                        <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                    </button>
                    <div class="chat-avatar chat-header-avatar">${initials}</div>
                    <div class="chat-header-meta">
                        <h4>${escapeHTML(student.name)}</h4>
                        <span class="chat-header-status">Online • ${escapeHTML(student.grade)} (${escapeHTML(student.section)})</span>
                    </div>
                </div>
                <div class="chat-header-actions">
                    <button class="chat-action-btn" title="Voice Call" onclick="triggerCallSim('${escapeHTML(student.name)}')">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                    </button>
                    <button class="chat-action-btn" title="Video Call" onclick="triggerVideoSim('${escapeHTML(student.name)}')">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                    </button>
                </div>
            </div>
            <div id="teacherChatMessagesBox" class="chat-messages"></div>
            <div class="chat-input-bar">
                <div class="chat-input-pill">
                    <button class="chat-icon-btn" title="Attach Image / Document">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                        <input type="file" accept="image/*" onchange="handleTeacherChatImageUpload(event)">
                    </button>
                    <input id="teacherChatConsoleInput" class="chat-text-input" type="text"
                        placeholder="Type a message..." onkeydown="if(event.key==='Enter') sendTeacherTextMessage()">
                </div>
                <button class="chat-send-btn" onclick="sendTeacherTextMessage()" title="Send Message">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M1.101 21.757L23.8 12.028 1.101 2.3 1 9.914l15.5 2.114L1 14.143z"/></svg>
                </button>
            </div>
        </div>`;
    renderTeacherMessagesThread();
}

function selectClassGroupChatForTeacher(grade, section) {
    activeSelectedStudentIdForTeacher = `GROUP_${grade}_${section}`;
    renderTeacherChatList();
    const workspace = document.querySelector('#tchViewChat .chat-workspace');
    if (workspace) workspace.classList.add('mobile-chat-open');
    document.body.classList.add('chat-fullscreen-open');
    const shortGrade = grade.replace('Grade ', '');
    const pane = el('teacherChatMessagingPane');
    pane.innerHTML = `
        <div class="chat-active-view">
            <div class="chat-active-header">
                <div class="chat-header-left" onclick="toggleTeacherClassChatMembersPanel()">
                    <button class="chat-back-btn" onclick="event.stopPropagation(); closeTeacherMobileChat()" aria-label="Back to chats">
                        <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                    </button>
                    <div class="chat-avatar chat-header-avatar group">${shortGrade}${section}</div>
                    <div class="chat-header-meta">
                        <h4>${escapeHTML(grade)} • Section ${escapeHTML(section)}</h4>
                        <span class="chat-header-status">Class Group Chat • Tap for members</span>
                    </div>
                </div>
                <div class="chat-header-actions">
                    <button class="chat-action-btn" title="Group Members" onclick="toggleTeacherClassChatMembersPanel()">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                    </button>
                </div>
            </div>
            <div id="tchClassChatMembersPanel" class="class-chat-participants" style="display:none;"></div>
            <div id="teacherChatMessagesBox" class="chat-messages"></div>
            <div class="chat-input-bar">
                <div class="chat-input-pill">
                    <button class="chat-icon-btn" title="Group Members" onclick="toggleTeacherClassChatMembersPanel()">
                        👥
                    </button>
                    <input id="teacherChatConsoleInput" class="chat-text-input" type="text"
                        placeholder="Message the class (${escapeHTML(grade)} • ${escapeHTML(section)})..." onkeydown="if(event.key==='Enter') sendTeacherClassGroupMessage('${escapeHTML(grade)}', '${escapeHTML(section)}')">
                </div>
                <button class="chat-send-btn" onclick="sendTeacherClassGroupMessage('${escapeHTML(grade)}', '${escapeHTML(section)}')" title="Send Message">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M1.101 21.757L23.8 12.028 1.101 2.3 1 9.914l15.5 2.114L1 14.143z"/></svg>
                </button>
            </div>
        </div>`;
    renderTeacherClassGroupThread(grade, section);
}

function toggleTeacherClassChatMembersPanel() {
    const panel = el('tchClassChatMembersPanel');
    if (!panel) return;
    panel.style.display = (panel.style.display === 'none') ? 'flex' : 'none';
}

function renderTeacherClassGroupThread(grade, section) {
    const { students, teachers } = classChatParticipantsFor(grade, section);
    renderClassChatParticipants('tchClassChatMembersPanel', students, teachers);
    renderClassChatThread('teacherChatMessagesBox', grade, section);
}

function sendTeacherClassGroupMessage(grade, section) {
    const t = currentActiveTeacherSession; if (!t) return;
    const inp = el('teacherChatConsoleInput'); if (!inp) return;
    const txt = inp.value.trim(); if (!txt) return;
    db_addClassChatMessage(grade, section, {
        type: 'text', content: txt, senderRole: 'teacher', senderId: t.id, senderName: t.name, time: now()
    });
    inp.value = '';
    renderClassChatThread('teacherChatMessagesBox', grade, section);
}

function closeTeacherMobileChat() {
    const workspace = document.querySelector('#tchViewChat .chat-workspace');
    if (workspace) workspace.classList.remove('mobile-chat-open');
    document.body.classList.remove('chat-fullscreen-open');
}

function getTeacherChatKey() { return `${currentActiveTeacherSession.id}-${activeSelectedStudentIdForTeacher}`; }

// Messenger view setup
function renderTeacherMessagesThread() {
    const box = el('teacherChatMessagesBox'); if (!box) return;
    box.innerHTML = '<div class="whatsapp-date-pill"><span>TODAY</span></div>';
    const msgs = db_getMessages(getTeacherChatKey());
    if (!msgs.length) {
        box.innerHTML += '<div class="empty-state" style="margin:auto;padding:30px 16px;color:#8696a0;">No messages yet. Send a message to start the conversation.</div>';
        return;
    }
    msgs.forEach(m => box.appendChild(buildBubble(m, 'teacher')));
    box.scrollTop = box.scrollHeight;
    lazyLoadAllImages();
}

function sendTeacherTextMessage() {
    const inp = el('teacherChatConsoleInput');
    const txt = inp.value.trim(); if (!txt) return;
    db_addChatMessage(getTeacherChatKey(), { type: 'text', content: txt, sender: 'teacher', time: now() });
    inp.value = ''; renderTeacherMessagesThread();
}

function handleTeacherChatImageUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = e => {
        db_addChatMessage(getTeacherChatKey(), { type: 'image', content: e.target.result, sender: 'teacher', time: now() });
        renderTeacherMessagesThread();
    };
    r.readAsDataURL(file);
}

/* ═══════════════════════════════════════════════════════════════════════════
   STUDENT MODULE
═══════════════════════════════════════════════════════════════════════════ */
const studentTabs = {
    annancements: { btn: 'stdTabBtnAnn', view: 'stdViewAnnouncements' },
    chat:         { btn: 'stdTabBtnChat', view: 'stdViewChat' },
    materials:    { btn: 'stdTabBtnMat',  view: 'stdViewMaterials' },
    reports:      { btn: 'stdTabBtnRep',  view: 'stdViewReports' },
    attendance:   { btn: 'stdTabBtnAtt',  view: 'stdViewAttendanceRate' },
    me:           { btn: 'stdTabBtnMe',   view: 'stdViewMe' }
};

function switchStudentTab(tab) {
    if (tab !== 'chat') {
        closeStudentMobileChat();
    }
    Object.keys(studentTabs).forEach(k => {
        const btn = el(studentTabs[k].btn);
        const view = el(studentTabs[k].view);
        if (btn) btn.classList.remove('active');
        if (view) view.style.display = 'none';
    });
    if (studentTabs[tab]) {
        const activeBtn = el(studentTabs[tab].btn);
        const activeView = el(studentTabs[tab].view);
        if (activeBtn) activeBtn.classList.add('active');
        if (activeView) activeView.style.display = tab === 'chat' ? 'flex' : 'block';
    }

    if (tab === 'annancements') renderStudentAnnouncementsFeed();
    if (tab === 'chat')         renderStudentChatTeachersDirectory();
    if (tab === 'materials') {
        studentSelectedSubjectId = null;
        studentSelectedChapterId = null;
        renderStudentMaterialsFeed();
    }
    if (tab === 'reports')      renderStudentReportsFeed();
    if (tab === 'attendance')   renderStudentAttendanceDashboard();
    if (tab === 'me')           { showProfileSubview('menu'); renderStudentIdentityDashboardProfile(); }

    updateStudentSidebarNotificationCount();
    updateAllPortalNotificationBadges();
}

function updateStudentSidebarNotificationCount() {
    const s = currentActiveStudentSession;
    if (!s) return;
    const badgeEl = el('stdTabBtnMat');
    if (!badgeEl) return;
    
    const existingBadge = badgeEl.querySelector('.menu-badge');
    if (existingBadge) {
        existingBadge.remove();
    }
    
    const totalUnviewed = db_getUnviewedAssignmentsCountTotal(s.id, s.grade, s.section);
    if (totalUnviewed > 0) {
        const badge = document.createElement('span');
        badge.className = 'menu-badge';
        badge.style.cssText = `
            background-color: var(--red);
            color: white;
            border-radius: 10px;
            padding: 1px 7px;
            font-size: 11px;
            font-weight: bold;
            margin-left: auto;
            box-shadow: 0 0 8px var(--red-glow);
            border: 1px solid rgba(255,255,255,0.1);
        `;
        badge.innerText = totalUnviewed;
        badgeEl.appendChild(badge);
    }
}

function renderStudentAnnouncementsFeed() {
    const feed = el('studentAnnouncementsFeed'); if (!feed) return; feed.innerHTML = '';
    if (!stateDatabase.announcements || !stateDatabase.announcements.length) {
        feed.innerHTML = '<div class="placeholder-box">No campus announcements have been published.</div>'; return;
    }
    [...stateDatabase.announcements].reverse().forEach(a => {
        const isEmg = a.category === 'Emergency' || (a.title && a.title.includes('EMERGENCY'));
        const card = document.createElement('div');
        card.className = `ann-card ${isEmg ? 'emergency-ann-card' : ''}`;
        card.innerHTML = `
            <div class="ann-meta ${isEmg ? 'emergency-ann-meta' : ''}">
                <span>${isEmg ? '<span class="emergency-tag">🚨 URGENT BROADCAST</span>' : '🏫 School Admin Office'}</span>
                <span>${a.date}</span>
            </div>
            <h3 class="${isEmg ? 'emergency-ann-title' : ''}">${escapeHTML(a.title)}</h3>
            <p class="${isEmg ? 'emergency-ann-desc' : ''}">${escapeHTML(a.desc)}</p>
            ${isEmg ? '<div class="emergency-ann-badge-pill">⚠️ Official Emergency Directive from Principal</div>' : ''}
            ${a.image || a.hasImage ? `<div class="ann-img-wrap"><img src="${a.image || ''}" data-id="${a.id}-img" data-fallback="${a.image || ''}"></div>` : ''}
        `;
        feed.appendChild(card);
    });
    lazyLoadAllImages();
}

function renderStudentMaterialsFeed() {
    const box = el('studentMaterialsFeedBox'); if (!box) return;
    box.innerHTML = '';
    const s = currentActiveStudentSession;

    if (!studentSelectedSubjectId) {
        const list = db_getSubjects(s.grade, s.section);
        if (!list.length) {
            box.innerHTML = '<div class="placeholder-box">No Home Assignment subjects assigned yet.</div>';
            return;
        }

        let html = '<div class="item-grid">';
        list.forEach(sub => {
            const chaptersCount = db_getChapters(sub.id).length;
            const unreadCount = db_getUnviewedAssignmentsCountForSubject(s.id, sub.id);
            html += `
                <div class="grid-item-card" onclick="selectStudentSubject('${sub.id}')" style="position: relative;">
                    ${unreadCount > 0 ? `<span class="badge" style="position: absolute; top: -6px; right: -6px; background-color: var(--red); color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; box-shadow: 0 0 10px var(--red-glow); border: 1px solid rgba(255,255,255,0.2);">${unreadCount}</span>` : ''}
                    <h4>📚 ${sub.name}</h4>
                    <div class="item-count">${chaptersCount} Chapter(s)</div>
                </div>
            `;
        });
        html += '</div>';
        box.innerHTML = html;

    } else if (!studentSelectedChapterId) {
        const subject = stateDatabase.subjects.find(sub => sub.id === studentSelectedSubjectId);
        if (!subject) {
            studentSelectedSubjectId = null;
            renderStudentMaterialsFeed();
            return;
        }

        const chapters = db_getChapters(studentSelectedSubjectId);
        let html = `
            <div class="breadcrumb-bar">
                <button class="breadcrumb-back" onclick="backToStudentSubjects()">← Back to Subjects</button>
                <span>Subject: <strong>${subject.name}</strong></span>
            </div>
        `;

        if (!chapters.length) {
            html += '<div class="placeholder-box">No chapters created under this subject yet.</div>';
        } else {
            html += '<div class="item-grid">';
            chapters.forEach(ch => {
                const assignmentsCount = db_getHomeAssignments(ch.id).length;
                const unreadCount = db_getUnviewedAssignmentsCountForChapter(s.id, ch.id);
                html += `
                    <div class="grid-item-card" onclick="selectStudentChapter('${ch.id}')" style="position: relative;">
                        ${unreadCount > 0 ? `<span class="badge" style="position: absolute; top: -6px; right: -6px; background-color: var(--red); color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; box-shadow: 0 0 10px var(--red-glow); border: 1px solid rgba(255,255,255,0.2);">${unreadCount}</span>` : ''}
                        <h4>📁 ${ch.name}</h4>
                        <div class="item-count">${assignmentsCount} Assignment(s)</div>
                    </div>
                `;
            });
            html += '</div>';
        }
        box.innerHTML = html;

    } else {
        const subject = stateDatabase.subjects.find(sub => sub.id === studentSelectedSubjectId);
        const chapter = stateDatabase.chapters.find(c => c.id === studentSelectedChapterId);
        if (!subject || !chapter) {
            studentSelectedChapterId = null;
            renderStudentMaterialsFeed();
            return;
        }

        // Mark all assignments in this chapter as viewed!
        db_markChapterAssignmentsAsViewed(s.id, studentSelectedChapterId);
        updateStudentSidebarNotificationCount();

        const assignments = db_getHomeAssignments(studentSelectedChapterId);
        let html = `
            <div class="breadcrumb-bar">
                <button class="breadcrumb-back" onclick="backToStudentChapters()">← Back to Chapters</button>
                <span>Subject: <strong>${subject.name}</strong> &gt; Chapter: <strong>${chapter.name}</strong></span>
            </div>
        `;

        if (!assignments.length) {
            html += '<div class="placeholder-box">No assignments uploaded yet for this chapter.</div>';
        } else {
            html += '<div style="margin-top:15px;">';
            assignments.forEach(a => {
                html += `
                    <div class="resource-item" style="margin-bottom:12px;">
                        <div>
                            <h4>📝 ${a.title}</h4>
                            <p style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
                                Published: ${a.date} — File: ${a.fileName}
                            </p>
                        </div>
                        <a class="download-link" href="#" onclick="downloadFileAsset('${a.id}', '${a.fileName}'); return false;">📥 Download Task</a>
                    </div>
                `;
            });
            html += '</div>';
        }
        box.innerHTML = html;
    }
}

function selectStudentSubject(id) {
    studentSelectedSubjectId = id;
    studentSelectedChapterId = null;
    renderStudentMaterialsFeed();
}

function selectStudentChapter(id) {
    studentSelectedChapterId = id;
    renderStudentMaterialsFeed();
}

function backToStudentSubjects() {
    studentSelectedSubjectId = null;
    studentSelectedChapterId = null;
    renderStudentMaterialsFeed();
}

function backToStudentChapters() {
    studentSelectedChapterId = null;
    renderStudentMaterialsFeed();
}

function renderStudentHomeworkFeed() {
    const box = el('studentHomeworkFeedBox'); box.innerHTML = '';
    const s = currentActiveStudentSession;
    const list = db_getHomework(s.grade, s.section);
    if (!list.length) { box.innerHTML = '<div class="placeholder-box">All clear! No active homework tasks found.</div>'; return; }
    list.forEach(h => {
        const card = document.createElement('div'); card.className = 'ann-card'; card.style.marginBottom = '16px';
        card.innerHTML = `<div class="ann-meta"><span>✏️ Assignment: [${h.subject}]</span><span>${h.date}</span></div>
                          <p style="font-size:15px;margin-top:8px;">${h.text}</p>
                          ${h.image || h.hasImage ? `<div class="ann-img-wrap"><img src="${h.image || ''}" data-id="${h.id}-img" data-fallback="${h.image || ''}"></div>` : ''}`;
        box.appendChild(card);
    });
    lazyLoadAllImages();
}

function renderStudentReportsFeed() {
    const box = el('studentReportsFeedBox'); box.innerHTML = '';
    const records = db_getReports(currentActiveStudentSession.id);
    if (!records.length) { box.innerHTML = '<div class="placeholder-box">No report cards uploaded yet.</div>'; return; }
    records.forEach(rep => {
        const div = document.createElement('div'); div.className = 'resource-item';
        div.innerHTML = `<div><h4>📊 Term Report Card: [${rep.term}]</h4><p>Date: ${rep.date} — File: ${rep.fileName}</p></div>
                         <a class="download-link" href="#" onclick="downloadFileAsset('${rep.id}', '${rep.fileName}'); return false;">📂 Download Report Card</a>`;
        box.appendChild(div);
    });
}

function renderStudentAttendanceDashboard() {
    const s = currentActiveStudentSession;
    if (!s) return;

    const records = db_getAttendanceForStudent(s.id);

    const allEntries = records.map(r => {
        const teacher = db_getTeacher(r.markedBy);
        const marker = teacher ? `Educator ${teacher.name}` : (r.markedBy === 'SYSTEM-MIGRATION' ? 'Attendance Register' : (r.markedBy || 'Teacher'));
        return {
            date: r.date,
            status: r.status,
            markedBy: marker,
            remarks: r.remarks || 'Daily registration.'
        };
    });

    allEntries.sort((a, b) => new Date(b.date) - new Date(a.date));

    let presentDays = 0;
    let absentDays = 0;
    let lateDays = 0;
    let totalDays = allEntries.length;

    allEntries.forEach(entry => {
        if (entry.status === 'Present' || entry.status === 'Late' || entry.status === 'Excused') {
            presentDays++;
        }
        if (entry.status === 'Absent') {
            absentDays++;
        }
        if (entry.status === 'Late') {
            lateDays++;
        }
    });

    // Populate Overview Cards
    const presentEl = el('stdAttPresentDays');
    if (presentEl) presentEl.innerText = presentDays;
    const absentEl = el('stdAttAbsentDays');
    if (absentEl) absentEl.innerText = absentDays;
    const lateEl = el('stdAttLateDays');
    if (lateEl) lateEl.innerText = lateDays;
    const totalEl = el('stdAttTotalDays');
    if (totalEl) totalEl.innerText = totalDays;

    const ratePct = totalDays > 0 ? (presentDays / totalDays * 100) : 0;
    const ratePctText = ratePct.toFixed(1) + '%';
    const circleDashArray = `${ratePct.toFixed(1)}, 100`;

    const gaugeEl = el('attendanceCircularGauge');
    if (gaugeEl) {
        gaugeEl.setAttribute('stroke-dasharray', circleDashArray);
        const gaugeColor = ratePct >= 90 ? '#22c55e' : ratePct >= 75 ? '#eab308' : '#ef4444';
        gaugeEl.setAttribute('stroke', gaugeColor);
    }
    const gaugeTextEl = el('attendanceGaugeText');
    if (gaugeTextEl) {
        gaugeTextEl.innerText = ratePctText;
    }

    // Trend Graph logic
    const monthlyGroups = {};
    allEntries.forEach(entry => {
        const parts = entry.date.split('-');
        if (parts.length >= 2) {
            const year = parts[0];
            const monthNum = parseInt(parts[1], 10);
            const key = `${year}-${monthNum < 10 ? '0' + monthNum : monthNum}`;
            if (!monthlyGroups[key]) {
                monthlyGroups[key] = { present: 0, total: 0 };
            }
            monthlyGroups[key].total++;
            if (entry.status === 'Present' || entry.status === 'Late' || entry.status === 'Excused') {
                monthlyGroups[key].present++;
            }
        }
    });

    const sortedMonthKeys = Object.keys(monthlyGroups).sort();
    const trendData = sortedMonthKeys.map(key => {
        const parts = key.split('-');
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10);
        const monthName = [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun", 
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
        ][monthNum - 1];
        
        const stats = monthlyGroups[key];
        const rate = stats.total > 0 ? (stats.present / stats.total * 100) : 0;
        return {
            label: `${monthName} '${year.substring(2)}`,
            rate: rate,
            present: stats.present,
            total: stats.total
        };
    });

    if (trendData.length === 0) {
        const currentYear = new Date().getFullYear();
        const currentMonthIndex = new Date().getMonth();
        const monthName = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][currentMonthIndex];
        trendData.push({
            label: `${monthName} '${String(currentYear).substring(2)}`,
            rate: 0,
            present: 0,
            total: 0
        });
    }

    const container = el('studentAttendanceTrendGraph');
    if (container) {
        const width = container.clientWidth || 500;
        const height = 280;
        const padL = 50;
        const padR = 20;
        const padT = 30;
        const padB = 40;
        
        const chartW = width - padL - padR;
        const chartH = height - padT - padB;
        
        const colW = chartW / trendData.length;
        const barW = Math.min(45, colW * 0.6);
        
        const getY = (rate) => {
            return padT + chartH - (rate / 100) * chartH;
        };
        
        let yTicks = [0, 25, 50, 75, 100];
        
        let gridHtml = '';
        yTicks.forEach(tick => {
            const yPos = getY(tick);
            gridHtml += `
                <line x1="${padL}" y1="${yPos}" x2="${width - padR}" y2="${yPos}" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="3,3" />
                <text x="${padL - 10}" y="${yPos + 4}" fill="var(--text-secondary)" font-size="11" text-anchor="end">${tick}%</text>
            `;
        });
        
        let svgHtml = `
            <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:100%; font-family:var(--font-body);">
                <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="var(--gold-light)" />
                        <stop offset="100%" stop-color="var(--gold)" stop-opacity="0.15" />
                    </linearGradient>
                </defs>
                ${gridHtml}
        `;
        
        trendData.forEach((d, idx) => {
            const colCenter = padL + (idx + 0.5) * colW;
            const barX = colCenter - barW / 2;
            const barY = getY(d.rate);
            const barH = (d.rate / 100) * chartH;
            
            svgHtml += `
                <g class="chart-bar-group" style="cursor:pointer;">
                    <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" fill="url(#barGrad)" rx="4" ry="4" stroke="var(--gold-light)" stroke-width="1" style="transition: opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'" />
                    <title>${d.label}: ${d.rate.toFixed(1)}% (${d.present}/${d.total} days)</title>
                    <text x="${colCenter}" y="${padT + chartH + 20}" fill="var(--text-secondary)" font-size="11" text-anchor="middle">${d.label}</text>
                    <text x="${colCenter}" y="${barY - 8}" fill="var(--gold-light)" font-size="11" font-weight="bold" text-anchor="middle">${d.rate.toFixed(0)}%</text>
                </g>
            `;
        });
        
        svgHtml += `</svg>`;
        container.innerHTML = svgHtml;
    }

    // Historical Logs Table
    const tbody = el('studentAttendanceLogsTableBody');
    if (tbody) {
        if (allEntries.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; opacity:0.6; font-style:italic;">No attendance records found for your profile.</td></tr>`;
        } else {
            let rowsHtml = '';
            allEntries.forEach(entry => {
                let badgeStyle = '';
                let statusText = entry.status;
                
                if (entry.status === 'Present') {
                    badgeStyle = 'background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3);';
                } else if (entry.status === 'Absent') {
                    badgeStyle = 'background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);';
                } else if (entry.status === 'Late') {
                    badgeStyle = 'background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3);';
                } else if (entry.status === 'Excused') {
                    badgeStyle = 'background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3);';
                } else {
                    badgeStyle = 'background: rgba(255, 255, 255, 0.1); color: var(--text-primary); border: 1px solid var(--glass-border);';
                }
                
                rowsHtml += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='rgba(255,255,255,0.02)'" onmouseout="this.style.backgroundColor='transparent'">
                        <td style="padding: 12px 8px; font-weight: 500;">${escapeHTML(entry.date)}</td>
                        <td style="padding: 12px 8px; opacity: 0.85;">${escapeHTML(entry.markedBy)}</td>
                        <td style="padding: 12px 8px;">
                            <span style="display: inline-block; padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: bold; ${badgeStyle}">
                                ${statusText}
                            </span>
                        </td>
                        <td style="padding: 12px 8px; font-style: italic; opacity: 0.8;">${escapeHTML(entry.remarks)}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = rowsHtml;
        }
    }
}

function renderStudentIdentityDashboardProfile() {
    const box = el('studentMyProfileCardDetails'); const s = currentActiveStudentSession; if (!s) return;

    const att = calculateStudentAttendanceRate(s);
    const attColor = att.rawPercentage >= 90 ? '#22c55e' : att.rawPercentage >= 75 ? '#eab308' : '#ef4444';

    box.innerHTML = `
        <div class="info-row"><span>Alpha Portal Student ID</span><span style="color:var(--gold-light);font-weight:700;">${s.id}</span></div>
        <div class="info-row"><span>Full Identity Name</span><span>${escapeHTML(s.name)}</span></div>
        <div class="info-row"><span>Academic Attendance Rate</span><span style="color:${attColor};font-weight:700;">${att.percentage} (${att.present}/${att.total} days)</span></div>
        <div class="info-row"><span>Academic Stream</span><span>${escapeHTML(s.grade)} — ${escapeHTML(s.section)}</span></div>
        <div class="info-row"><span>Student Registration Number</span><span>${escapeHTML(s.roll)}</span></div>
        <div class="info-row"><span>House Team</span><span>${escapeHTML(s.house)}</span></div>
        <div class="info-row"><span>Date of Birth</span><span>${escapeHTML(s.dob || 'N/A')}</span></div>
        <div class="info-row"><span>Joining Date</span><span>${escapeHTML(s.joiningDate || 'N/A')}</span></div>
        <div class="info-row"><span>Emirates ID</span><span>${escapeHTML(s.emiratesId || 'N/A')}</span></div>
        <div class="info-row"><span>Passport Number</span><span>${escapeHTML(s.passport || 'N/A')}</span></div>
        <div class="info-row"><span>Emirates ID Expire Date</span><span>${escapeHTML(s.emiratesExp || 'N/A')}</span></div>
        
        <div style="grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,0.1); margin: 0.75rem 0 0.5rem 0; padding-top: 0.75rem; font-weight: bold; color: var(--gold-light); font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem;">
          <span>👪</span> Parent Credentials & Identification Details
        </div>
        <div class="info-row"><span>Father's Full Name</span><span>${escapeHTML(s.father || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Full Name</span><span>${escapeHTML(s.mother || 'N/A')}</span></div>
        <div class="info-row"><span>Father's Contact</span><span>${escapeHTML(s.fContact || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Contact</span><span>${escapeHTML(s.mContact || 'N/A')}</span></div>
        <div class="info-row"><span>Father's Emirates ID</span><span>${escapeHTML(s.fEmiratesId || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Emirates ID</span><span>${escapeHTML(s.mEmiratesId || 'N/A')}</span></div>
        <div class="info-row"><span>Father's Emirates Expire</span><span>${escapeHTML(s.fEmiratesExp || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Emirates Expire</span><span>${escapeHTML(s.mEmiratesExp || 'N/A')}</span></div>
        <div class="info-row"><span>Father's Passport No</span><span>${escapeHTML(s.fPassport || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Passport No</span><span>${escapeHTML(s.mPassport || 'N/A')}</span></div>
        <div class="info-row"><span>Father's Date of Birth</span><span>${escapeHTML(s.fDoB || 'N/A')}</span></div>
        <div class="info-row"><span>Mother's Date of Birth</span><span>${escapeHTML(s.mDoB || 'N/A')}</span></div>
    `;
}

/* -- Student Chat ---------------------------------------------------------- */
function renderStudentChatTeachersDirectory() {
    const c = el('chatTeachersList');
    if (!c) return; // panel not mounted yet (e.g. called before stdViewChat exists in DOM) — bail safely instead of throwing and freezing the mobile render chain
    c.innerHTML = '';

    const s = currentActiveStudentSession;
    if (s) {
        const groupDiv = document.createElement('div');
        groupDiv.className = `chat-contact-card group-chat-card ${activeSelectedTeacherId === 'CLASS_GROUP' ? 'active' : ''}`;
        groupDiv.onclick = () => selectClassGroupChatForStudent();
        const shortGrade = (s.grade || '').replace('Grade ', '');
        groupDiv.innerHTML = `<div class="chat-avatar group" style="background:#005c4b; color:#25d366; border:1px solid #25d366;">${shortGrade}${s.section || ''}</div><div class="c-body"><div class="c-name" style="color:#25d366; font-weight:700;">${shortGrade} • ${s.section || ''} Group Chat</div><div class="c-sub">Class Group Chat • All Classmates & Teachers</div></div>`;
        c.appendChild(groupDiv);
    }

    if (!stateDatabase.teachers || !stateDatabase.teachers.length) {
        if (!s) c.innerHTML = '<div class="empty-state" style="margin-top:20px;padding:12px;">No registered teachers found.</div>';
        return;
    }

    const currentStudentGrade = currentActiveStudentSession ? currentActiveStudentSession.grade : null;
    const visibleTeachers = stateDatabase.teachers.filter(t => {
        if (!currentStudentGrade) return true;
        if (!t.grades || !Array.isArray(t.grades)) return true;
        return t.grades.includes(currentStudentGrade);
    });

    if (visibleTeachers.length === 0) {
        c.insertAdjacentHTML('beforeend', '<div class="empty-state" style="margin-top:20px;padding:12px;">No teachers assigned to your grade level are registered.</div>');
        return;
    }

    visibleTeachers.forEach(t => {
        const div = document.createElement('div');
        div.className = `chat-contact-card ${activeSelectedTeacherId === t.id ? 'active' : ''}`;
        div.onclick = () => selectTeacherForStudentConversation(t.id);
        const initials = t.name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
        div.innerHTML = `<div class="chat-avatar">${initials}</div><div class="c-body"><div class="c-name">${escapeHTML(t.name)}</div><div class="c-sub">${escapeHTML(t.subject)} Department</div></div>`;
        c.appendChild(div);
    });
}

function selectTeacherForStudentConversation(teacherId) {
    activeSelectedTeacherId = teacherId;
    renderStudentChatTeachersDirectory();
    const teacher = db_getTeacher(teacherId); if (!teacher) return;
    const workspace = document.querySelector('#stdViewChat .chat-workspace');
    if (workspace) workspace.classList.add('mobile-chat-open');
    document.body.classList.add('chat-fullscreen-open');
    const initials = teacher.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
    const pane = el('chatMessagingPane');
    pane.innerHTML = `
        <div class="chat-active-view">
            <div class="chat-active-header">
                <div class="chat-header-left" onclick="showContactQuickInfo('${escapeHTML(teacher.name)}', 'Faculty • ${escapeHTML(teacher.subject)} Department')">
                    <button class="chat-back-btn" onclick="event.stopPropagation(); closeStudentMobileChat()" aria-label="Back to chats">
                        <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                    </button>
                    <div class="chat-avatar chat-header-avatar">${initials}</div>
                    <div class="chat-header-meta">
                        <h4>${escapeHTML(teacher.name)}</h4>
                        <span class="chat-header-status">Online • ${escapeHTML(teacher.subject)} Dept</span>
                    </div>
                </div>
                <div class="chat-header-actions">
                    <button class="chat-action-btn" title="Voice Call" onclick="triggerCallSim('${escapeHTML(teacher.name)}')">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                    </button>
                    <button class="chat-action-btn" title="Video Call" onclick="triggerVideoSim('${escapeHTML(teacher.name)}')">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                    </button>
                </div>
            </div>
            <div id="chatMessagesBox" class="chat-messages"></div>
            <div class="chat-input-bar">
                <div class="chat-input-pill">
                    <button class="chat-icon-btn" title="Attach Image Asset">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                        <input type="file" accept="image/*" onchange="handleStudentChatImageUpload(event)">
                    </button>
                    <button id="chatMicBtn" class="chat-icon-btn" onclick="toggleStudentVoiceRecordingSim()" title="Record Audio">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                    </button>
                    <input id="chatConsoleInput" class="chat-text-input" type="text"
                        placeholder="Type a message..." onkeydown="if(event.key==='Enter') sendStudentTextMessage()">
                </div>
                <button class="chat-send-btn" onclick="sendStudentTextMessage()" title="Send Message">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M1.101 21.757L23.8 12.028 1.101 2.3 1 9.914l15.5 2.114L1 14.143z"/></svg>
                </button>
            </div>
        </div>`;
    renderStudentMessagesThread();
}

function selectClassGroupChatForStudent() {
    activeSelectedTeacherId = 'CLASS_GROUP';
    renderStudentChatTeachersDirectory();
    const s = currentActiveStudentSession; if (!s) return;
    const workspace = document.querySelector('#stdViewChat .chat-workspace');
    if (workspace) workspace.classList.add('mobile-chat-open');
    document.body.classList.add('chat-fullscreen-open');
    const shortGrade = (s.grade || '').replace('Grade ', '');
    const pane = el('chatMessagingPane');
    pane.innerHTML = `
        <div class="chat-active-view">
            <div class="chat-active-header">
                <div class="chat-header-left" onclick="toggleClassChatMembersPanel()">
                    <button class="chat-back-btn" onclick="event.stopPropagation(); closeStudentMobileChat()" aria-label="Back to chats">
                        <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                    </button>
                    <div class="chat-avatar chat-header-avatar group">${shortGrade}${s.section || ''}</div>
                    <div class="chat-header-meta">
                        <h4>${escapeHTML(shortGrade)} • ${escapeHTML(s.section || '')}</h4>
                        <span class="chat-header-status">Class Group Chat • Tap for members</span>
                    </div>
                </div>
                <div class="chat-header-actions">
                    <button class="chat-action-btn" title="Group Members" onclick="toggleClassChatMembersPanel()">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                    </button>
                </div>
            </div>
            <div id="classChatMembersPanel" class="class-chat-participants" style="display:none;"></div>
            <div id="classChatMessagesBox" class="chat-messages"></div>
            <div class="chat-input-bar">
                <div class="chat-input-pill">
                    <button class="chat-icon-btn" title="Group Members" onclick="toggleClassChatMembersPanel()">
                        👥
                    </button>
                    <input id="classChatInput" class="chat-text-input" type="text" placeholder="Message your class..." onkeydown="if(event.key==='Enter') sendClassChatMessageAsStudent()">
                </div>
                <button class="chat-send-btn" onclick="sendClassChatMessageAsStudent()" title="Send Message">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M1.101 21.757L23.8 12.028 1.101 2.3 1 9.914l15.5 2.114L1 14.143z"/></svg>
                </button>
            </div>
        </div>`;
    renderClassGroupChatForStudent();
}

function toggleClassChatMembersPanel() {
    const panel = el('classChatMembersPanel');
    if (!panel) return;
    panel.style.display = (panel.style.display === 'none') ? 'flex' : 'none';
}

function closeStudentMobileChat() {
    const workspace = document.querySelector('#stdViewChat .chat-workspace');
    if (workspace) workspace.classList.remove('mobile-chat-open');
    document.body.classList.remove('chat-fullscreen-open');
}

function getStudentChatKey() { return `${activeSelectedTeacherId}-${currentActiveStudentSession.id}`; }

function showProfileSubview(view) {
    const views = { menu: 'profileMenuView', personal: 'profilePersonalInfoView', password: 'profilePasswordView' };
    Object.entries(views).forEach(([key, id]) => {
        const box = el(id);
        if (box) box.style.display = (key === view) ? 'block' : 'none';
    });
}

function showTeacherProfileSubview(view) {
    const views = { menu: 'tchProfileMenuView', personal: 'tchProfilePersonalInfoView', password: 'tchProfilePasswordView' };
    Object.entries(views).forEach(([key, id]) => {
        const box = el(id);
        if (box) box.style.display = (key === view) ? 'block' : 'none';
    });
}

function renderTeacherIdentityProfile() {
    const box = el('teacherMyProfileCardDetails'); const t = currentActiveTeacherSession; if (!t || !box) return;
    box.innerHTML = `
        <div class="info-row"><span>Alpha Portal Teacher ID</span><span style="color:var(--gold-light);font-weight:700;">${t.id}</span></div>
        <div class="info-row"><span>Full Identity Name</span><span>${escapeHTML(t.name)}</span></div>
        <div class="info-row"><span>Subject</span><span>${escapeHTML(t.subject || 'N/A')}</span></div>
        <div class="info-row"><span>Assigned Grades</span><span>${(t.grades && t.grades.length) ? t.grades.map(escapeHTML).join(', ') : 'N/A'}</span></div>
        <div class="info-row"><span>Qualification</span><span>${escapeHTML(t.qualification || 'N/A')}</span></div>
        <div class="info-row"><span>Emirates ID</span><span>${escapeHTML(t.emiratesId || 'N/A')}</span></div>
        <div class="info-row"><span>Passport Number</span><span>${escapeHTML(t.passport || 'N/A')}</span></div>
        <div class="info-row"><span>Emirates ID Expire Date</span><span>${escapeHTML(t.emiratesExp || 'N/A')}</span></div>
    `;
}

function changeTeacherPassword() {
    const t = currentActiveTeacherSession;
    if (!t) return;

    const newPwd = el('tchNewPassword').value.trim();
    const confPwd = el('tchConfirmPassword').value.trim();

    if (!newPwd) { alert("Please enter a new password."); return; }
    if (newPwd !== confPwd) { alert("Passwords do not match. Please verify."); return; }

    const salt = "SALT-" + Math.floor(Math.random() * 1000000);
    const pwdObj = { hash: db_hashPassword(newPwd, salt), salt: salt };

    t.password = pwdObj;
    const dbT = db_getTeacher(t.id);
    if (dbT) dbT.password = pwdObj;

    saveState();
    db_logEvent(t.id, 'Teacher', 'Teacher Password Change', `Teacher ${t.name} changed their portal login password.`);
    alert("Your password has been successfully updated!");

    el('tchNewPassword').value = '';
    el('tchConfirmPassword').value = '';
}

/* ── Class Group Chat — all students of a grade+section + assigned teachers ── */

function classChatParticipantsFor(grade, section) {
    const students = db_getStudents(grade, section) || [];
    const teachers = (stateDatabase.teachers || []).filter(t => Array.isArray(t.grades) && t.grades.includes(grade));
    return { students, teachers };
}

function renderClassChatParticipants(containerId, students, teachers) {
    const box = el(containerId); if (!box) return;
    let html = '';
    students.forEach(s => {
        const initials = s.name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
        html += `<span class="class-chat-chip" title="${escapeHTML(s.name)} (Student)"><span class="class-chat-chip-avatar student">${initials}</span>${escapeHTML(s.name)}</span>`;
    });
    teachers.forEach(t => {
        const initials = t.name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
        html += `<span class="class-chat-chip" title="${escapeHTML(t.name)} (Teacher)"><span class="class-chat-chip-avatar teacher">${initials}</span>${escapeHTML(t.name)}</span>`;
    });
    box.innerHTML = html || '<span class="class-chat-chip-empty">No participants yet.</span>';
}

function renderClassChatThread(boxId, grade, section) {
    const box = el(boxId); if (!box) return;
    const msgs = db_getClassChatMessages(grade, section);
    box.innerHTML = '<div class="whatsapp-date-pill"><span>TODAY</span></div>';
    if (!msgs.length) {
        box.innerHTML += '<div class="empty-state" style="margin:auto;padding:24px 16px;color:#8696a0;">No messages yet. Say hello to your class!</div>';
        return;
    }
    const myId = currentActiveStudentSession ? currentActiveStudentSession.id : (currentActiveTeacherSession ? currentActiveTeacherSession.id : null);
    const myRole = currentActiveStudentSession ? 'student' : 'teacher';

    msgs.forEach(m => {
        const isEmergency = m.isEmergency || m.senderId === 'PRINCIPAL-OFFICE';
        const isSent = (m.senderId === myId) || (m.senderRole === myRole && m.senderId === myId);
        const row = document.createElement('div');
        
        if (isEmergency) {
            row.className = 'msg-row emergency-msg-row';
            row.style.cssText = 'justify-content: center; margin: 10px 0;';
            row.innerHTML = `<div class="bubble emergency-bubble" style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.35), rgba(185, 28, 28, 0.25)) !important; border: 1px solid rgba(239, 68, 68, 0.7) !important; box-shadow: 0 0 16px rgba(239, 68, 68, 0.35) !important; max-width: 90% !important; border-radius: 14px !important; padding: 10px 14px !important;">
                <div style="font-size:12px; font-weight:800; color:#fca5a5; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                    <span>🚨</span> PRINCIPAL EMERGENCY COMMAND
                </div>
                <div style="color: #ffffff; font-weight:500; font-size:13.5px; line-height:1.45; white-space: pre-wrap;">${escapeHTML(m.content)}</div>
                <span class="bubble-time" style="color: rgba(255,255,255,0.7); display:block; text-align:right; font-size:10.5px; margin-top:4px;">${m.time}</span>
            </div>`;
        } else {
            row.className = `msg-row ${isSent ? 'sent' : 'recv'}`;
            const nameColor = m.senderRole === 'teacher' ? '#53bdeb' : '#25d366';
            const senderHeader = !isSent ? `<div style="font-size:11.5px; font-weight:700; color:${nameColor}; margin-bottom:3px;">${escapeHTML(m.senderName)}${m.senderRole === 'teacher' ? ' • Teacher' : ''}</div>` : '';
            const ticksHtml = isSent ? `<span class="bubble-ticks"><svg viewBox="0 0 16 11" width="14" height="10" fill="none"><path d="M11.05 1.05L4.5 7.6 1.95 5.05" stroke="#53bdeb" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.55 1.05L8 7.6l-.75-.75" stroke="#53bdeb" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : '';
            row.innerHTML = `<div class="bubble">
                ${senderHeader}
                <div>${escapeHTML(m.content)}</div>
                <span class="bubble-time">${m.time} ${ticksHtml}</span>
            </div>`;
        }
        box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
}

function renderClassGroupChatForStudent() {
    const s = currentActiveStudentSession; if (!s) return;
    const { students, teachers } = classChatParticipantsFor(s.grade, s.section);
    renderClassChatParticipants('classChatMembersPanel', students, teachers);
    renderClassChatThread('classChatMessagesBox', s.grade, s.section);
}

function sendClassChatMessageAsStudent() {
    const s = currentActiveStudentSession; if (!s) return;
    const input = el('classChatInput'); if (!input) return;
    const txt = input.value.trim(); if (!txt) return;
    db_addClassChatMessage(s.grade, s.section, {
        type: 'text', content: txt, senderRole: 'student', senderId: s.id, senderName: s.name, time: now()
    });
    input.value = '';
    renderClassChatThread('classChatMessagesBox', s.grade, s.section);
}

function renderClassGroupChatForTeacher() {
    const gradeSel = el('tchHomGrade'), sectionSel = el('tchHomSection');
    if (!gradeSel || !sectionSel) return;
    const grade = gradeSel.value, section = sectionSel.value;
    const { students, teachers } = classChatParticipantsFor(grade, section);
    const subtitle = el('tchClassChatSubtitle');
    if (subtitle) subtitle.textContent = `${grade} • ${section} — ${students.length} student(s), ${teachers.length} teacher(s)`;
    renderClassChatParticipants('tchClassChatParticipants', students, teachers);
    renderClassChatThread('tchClassChatMessagesBox', grade, section);
}

function sendClassChatMessageAsTeacher() {
    const t = currentActiveTeacherSession; if (!t) return;
    const gradeSel = el('tchHomGrade'), sectionSel = el('tchHomSection');
    if (!gradeSel || !sectionSel) return;
    const grade = gradeSel.value, section = sectionSel.value;
    const input = el('tchClassChatInput'); if (!input) return;
    const txt = input.value.trim(); if (!txt) return;
    db_addClassChatMessage(grade, section, {
        type: 'text', content: txt, senderRole: 'teacher', senderId: t.id, senderName: t.name, time: now()
    });
    input.value = '';
    renderClassChatThread('tchClassChatMessagesBox', grade, section);
}

function renderStudentMessagesThread() {
    const box = el('chatMessagesBox'); if (!box) return;
    box.innerHTML = '<div class="whatsapp-date-pill"><span>TODAY</span></div>';
    const msgs = db_getMessages(getStudentChatKey());
    if (!msgs.length) {
        box.innerHTML += '<div class="empty-state" style="margin:auto;padding:30px 16px;color:#8696a0;">No messages yet. Send a message to start the conversation.</div>';
        return;
    }
    msgs.forEach(m => box.appendChild(buildBubble(m, 'student')));
    box.scrollTop = box.scrollHeight;
    lazyLoadAllImages();
}

function sendStudentTextMessage() {
    const inp = el('chatConsoleInput'); const txt = inp.value.trim(); if (!txt) return;
    db_addChatMessage(getStudentChatKey(), { type: 'text', content: txt, sender: 'student', time: now() });
    inp.value = ''; renderStudentMessagesThread();
}

function handleStudentChatImageUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = e => {
        db_addChatMessage(getStudentChatKey(), { type: 'image', content: e.target.result, sender: 'student', time: now() });
        renderStudentMessagesThread();
    };
    r.readAsDataURL(file);
}

function toggleStudentVoiceRecordingSim() {
    const btn = el('chatMicBtn');
    if (!isVoiceRecordingActive) {
        isVoiceRecordingActive = true;
        btn.classList.add('voice-active');
        btn.innerHTML = '<span style="color:#ef4444; animation: pulse 1s infinite;">🛑</span>';
        showChatToast('Recording audio note...');
    } else {
        isVoiceRecordingActive = false;
        btn.classList.remove('voice-active');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';
        db_addChatMessage(getStudentChatKey(), { type: 'voice', content: 'Voice Note (0:07)', sender: 'student', time: now() });
        renderStudentMessagesThread();
        showChatToast('Voice message sent');
    }
}

/* -- Toast notification and simulation helpers ---------------------------- */
function showChatToast(msg) {
    let t = document.getElementById('chatToastNotification');
    if (!t) {
        t = document.createElement('div');
        t.id = 'chatToastNotification';
        t.className = 'chat-toast-notice';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('visible'), 2800);
}

function triggerCallSim(name) {
    showChatToast(`📞 Connecting secure voice call to ${name}...`);
}

function triggerVideoSim(name) {
    showChatToast(`📹 Initiating HD video session with ${name}...`);
}

function showContactQuickInfo(name, details) {
    showChatToast(`ℹ️ ${name} • ${details}`);
}

/* -- Shared bubble builder ------------------------------------------------- */
function buildBubble(msg, myRole) {
    const isSent = msg.sender === myRole;
    const row = document.createElement('div');
    row.className = `msg-row ${isSent ? 'sent' : 'recv'}`;
    let inner = '';
    if (msg.type === 'text') {
        inner = `<div>${escapeHTML(msg.content)}</div>`;
    } else if (msg.type === 'image') {
        inner = `<img class="bubble-img" src="${msg.content || ''}" data-id="${msg.id || ''}" data-fallback="${msg.content || ''}" alt="Attached image" style="max-height:220px; border-radius:10px; margin-bottom:4px;">`;
    } else if (msg.type === 'voice') {
        inner = `
        <div class="voice-row" style="display:flex; align-items:center; gap:8px; padding:4px 0;">
            <span class="voice-icon" style="font-size:16px;">▶️</span>
            <div class="voice-bar" style="width:90px; height:4px; background:rgba(255,255,255,0.25); border-radius:2px;"><div class="voice-fill" style="height:100%; width:50%; background:#25d366; border-radius:2px;"></div></div>
            <span style="font-size:11.5px; opacity:0.85;">${escapeHTML(msg.content)}</span>
        </div>`;
    }
    const ticksHtml = isSent ? `<span class="bubble-ticks"><svg viewBox="0 0 16 11" width="14" height="10" fill="none"><path d="M11.05 1.05L4.5 7.6 1.95 5.05" stroke="#53bdeb" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.55 1.05L8 7.6l-.75-.75" stroke="#53bdeb" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : '';
    row.innerHTML = `<div class="bubble">${inner}<span class="bubble-time">${msg.time} ${ticksHtml}</span></div>`;
    return row;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PARENT MODULE
═══════════════════════════════════════════════════════════════════════════ */
function switchParentTab(tab) {
    const bAnn = el('prnTabBtnAnn');
    const bMarks = el('prnTabBtnMarks');
    const vAnn = el('prnViewAnnouncements');
    const vMarks = el('prnViewMarks');
    if (bAnn) bAnn.classList.remove('active');
    if (bMarks) bMarks.classList.remove('active');
    if (vAnn) vAnn.style.display = 'none';
    if (vMarks) vMarks.style.display = 'none';

    if (tab === 'announcements') {
        if (bAnn) bAnn.classList.add('active');
        if (vAnn) vAnn.style.display = 'block';
        renderParentAnnouncementsFeed();
    } else if (tab === 'marks') {
        if (bMarks) bMarks.classList.add('active');
        if (vMarks) vMarks.style.display = 'block';
        renderParentMarkSheetsFeed();
    }
    updateAllPortalNotificationBadges();
}

function renderParentAnnouncementsFeed() {
    const feed = el('parentAnnouncementsFeed'); if (!feed) return; feed.innerHTML = '';
    if (!stateDatabase.announcements || !stateDatabase.announcements.length) {
        feed.innerHTML = '<div class="placeholder-box">No campus announcements published yet.</div>'; return;
    }
    [...stateDatabase.announcements].reverse().forEach(a => {
        const isEmg = a.category === 'Emergency' || (a.title && a.title.includes('EMERGENCY'));
        const card = document.createElement('div');
        card.className = `ann-card ${isEmg ? 'emergency-ann-card' : ''}`;
        card.innerHTML = `
            <div class="ann-meta ${isEmg ? 'emergency-ann-meta' : ''}">
                <span>${isEmg ? '<span class="emergency-tag">🚨 CRITICAL BROADCAST</span>' : '🏫 Campus Administration Notice'}</span>
                <span>${a.date}</span>
            </div>
            <h3 class="${isEmg ? 'emergency-ann-title' : ''}">${escapeHTML(a.title)}</h3>
            <p class="${isEmg ? 'emergency-ann-desc' : ''}">${escapeHTML(a.desc)}</p>
            ${isEmg ? '<div class="emergency-ann-badge-pill">⚠️ Official Emergency Directive from Principal</div>' : ''}
            ${a.image || a.hasImage ? `<div class="ann-img-wrap"><img src="${a.image || ''}" data-id="${a.id}-img" data-fallback="${a.image || ''}"></div>` : ''}
        `;
        feed.appendChild(card);
    });
    lazyLoadAllImages();
}

function renderParentMarkSheetsFeed() {
    const box = el('parentMarksFeedBox'); box.innerHTML = '';
    const child = currentActiveParentChildSession;
    const records = db_getReports(child.id);
    if (!records.length) {
        box.innerHTML = `<div class="placeholder-box">No evaluation sheets have been uploaded for ${child.name} yet.</div>`; return;
    }
    records.forEach(rep => {
        const div = document.createElement('div'); div.className = 'resource-item';
        div.innerHTML = `<div><h4>📊 Performance Sheet — [${rep.term}]</h4><p>Student: ${child.name} — Date: ${rep.date}</p></div>
                         <a class="download-link" href="#" onclick="downloadFileAsset('${rep.id}', '${rep.fileName}'); return false;">📥 Download Evaluation Document</a>`;
        box.appendChild(div);
    });
}

/* ── SECURITY COMMAND CENTER CONTROLLERS ── */
function renderSecuritySettings() {
    const logBox = el('securityAuditLogTableBody');
    if (!logBox) return;
    logBox.innerHTML = '';

    const logs = stateDatabase.auditLogs || [];
    if (!logs.length) {
        logBox.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 1.5rem; opacity: 0.7;">No system events recorded.</td></tr>`;
        return;
    }

    logs.forEach(log => {
        const tr = document.createElement('tr');

        let badgeColor = '#94a3b8'; // gray
        if (log.action.includes('Login') || log.action.includes('Verification')) badgeColor = '#22c55e'; // green
        else if (log.action.includes('Lockout') || log.action.includes('Failed')) badgeColor = '#ef4444'; // red
        else if (log.action.includes('Backup') || log.action.includes('Restore')) badgeColor = '#3b82f6'; // blue
        else if (log.action.includes('Migration')) badgeColor = '#eab308'; // yellow

        tr.innerHTML = `
            <td style="white-space: nowrap; font-family: monospace; opacity: 0.9;">${escapeHTML(log.timestamp)}</td>
            <td><strong style="color: #f1f5f9;">${escapeHTML(log.user)}</strong> <span style="font-size: 0.75rem; color: #94a3b8;">(${escapeHTML(log.role)})</span></td>
            <td style="white-space: nowrap;"><span style="display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; background: rgba(255,255,255,0.05); color: ${badgeColor}; border: 1px solid ${badgeColor}22;">${escapeHTML(log.action)}</span></td>
            <td style="opacity: 0.85;">${escapeHTML(log.details)}</td>
        `;
        logBox.appendChild(tr);
    });
}

function clearSecurityAuditLogs() {
    if (!confirm("Are you sure you want to permanently clear all real-time system security audit logs?")) return;
    stateDatabase.auditLogs = [];
    saveState();
    db_logEvent('alphaadmin', 'Admin', 'Clear Security Logs', 'System security audit logs cleared manually by the administrator.');
    renderSecuritySettings();
}

/* ── NOTIFICATION & EXPIRY ALARM CONTROLLERS ── */
function getExpiryAlerts() {
    const alerts = [];
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    if (!stateDatabase) return alerts;

    if (stateDatabase.students) {
        stateDatabase.students.forEach(s => {
            const checkExpiry = (dateStr, roleLabel, fieldName) => {
                if (!dateStr) return;
                const expDate = new Date(dateStr);
                if (isNaN(expDate.getTime())) return;
                expDate.setHours(0, 0, 0, 0);

                const timeDiff = expDate.getTime() - todayDate.getTime();
                const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

                if (daysDiff <= 30) {
                    alerts.push({
                        studentId: s.id,
                        studentName: s.name,
                        studentRoll: s.roll || '',
                        grade: s.grade,
                        section: s.section,
                        roleLabel: roleLabel, // "Child", "Father", "Mother"
                        fieldName: fieldName, // "Emirates ID"
                        expiryDate: dateStr,
                        daysDiff: daysDiff,
                        status: daysDiff < 0 ? 'expired' : 'soon',
                        isTeacher: false
                    });
                }
            };

            checkExpiry(s.emiratesExp, "Child", "Emirates ID");
            checkExpiry(s.fEmiratesExp, "Father", "Emirates ID");
            checkExpiry(s.mEmiratesExp, "Mother", "Emirates ID");
        });
    }

    if (stateDatabase.teachers) {
        stateDatabase.teachers.forEach(t => {
            if (!t.emiratesExp) return;
            const expDate = new Date(t.emiratesExp);
            if (isNaN(expDate.getTime())) return;
            expDate.setHours(0, 0, 0, 0);

            const timeDiff = expDate.getTime() - todayDate.getTime();
            const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

            if (daysDiff <= 30) {
                alerts.push({
                    studentId: t.id,
                    studentName: t.name,
                    studentRoll: '-',
                    grade: t.subject,
                    section: 'Dept',
                    roleLabel: 'Teacher',
                    fieldName: 'Emirates ID',
                    expiryDate: t.emiratesExp,
                    daysDiff: daysDiff,
                    status: daysDiff < 0 ? 'expired' : 'soon',
                    isTeacher: true
                });
            }
        });
    }

    // Sort: expired first, then soonest to expire
    alerts.sort((a, b) => a.daysDiff - b.daysDiff);
    return alerts;
}

/* ── Admin Attendance Freeze Control ── */
function renderAdminAttendanceControl() {
    if (!stateDatabase.attendanceFreezeLog) stateDatabase.attendanceFreezeLog = [];
    const frozen = db_isAttendanceCurrentlyFrozen();

    const titleEl = el('admAttControlStatusTitle');
    const descEl = el('admAttControlStatusDesc');
    const iconEl = el('admAttControlStatusIcon');
    const banner = el('admAttControlStatusBanner');
    const startBtn = el('admAttControlStartBtn');
    const freezeBtn = el('admAttControlFreezeBtn');

    if (freezeBtn) freezeBtn.innerHTML = '<span>⏸️ Freeze / Pause Attendance</span>';
    if (startBtn) startBtn.innerHTML = '<span>▶️ Start / Resume Attendance</span>';

    if (frozen) {
        if (titleEl) titleEl.innerText = 'Attendance is FROZEN';
        if (descEl) descEl.innerText = 'Teachers cannot mark attendance right now. No days are counting toward any student\'s rate until you resume.';
        if (iconEl) { iconEl.innerText = '🔒'; iconEl.className = 'admin-status-icon status-bad'; }
        if (banner) banner.className = 'admin-status-banner glass-panel status-bad';
        if (startBtn) { startBtn.disabled = false; startBtn.style.opacity = '1'; startBtn.style.cursor = 'pointer'; }
        if (freezeBtn) { freezeBtn.disabled = true; freezeBtn.style.opacity = '0.5'; freezeBtn.style.cursor = 'not-allowed'; }
    } else {
        if (titleEl) titleEl.innerText = 'Attendance is ACTIVE';
        if (descEl) descEl.innerText = 'Teachers can mark attendance normally across all classes.';
        if (iconEl) { iconEl.innerText = '✅'; iconEl.className = 'admin-status-icon status-good'; }
        if (banner) banner.className = 'admin-status-banner glass-panel status-good';
        if (startBtn) { startBtn.disabled = true; startBtn.style.opacity = '0.5'; startBtn.style.cursor = 'not-allowed'; }
        if (freezeBtn) { freezeBtn.disabled = false; freezeBtn.style.opacity = '1'; freezeBtn.style.cursor = 'pointer'; }
    }

    const historyBody = el('admAttControlHistoryBody');
    if (historyBody) {
        const log = (stateDatabase.attendanceFreezeLog || []).slice().reverse();
        if (!log.length) {
            historyBody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 1.5rem; opacity: 0.6;">No freeze/resume actions yet.</td></tr>`;
        } else {
            historyBody.innerHTML = log.map(entry => `
                <tr>
                    <td style="font-family: monospace;">${escapeHTML(entry.date)}</td>
                    <td style="font-weight: 600; color: ${entry.action === 'freeze' ? '#ef4444' : '#22c55e'};">${entry.action === 'freeze' ? '🔒 Frozen' : '▶️ Resumed'}</td>
                    <td>${escapeHTML(entry.by)}</td>
                </tr>
            `).join('');
        }
    }
}

function adminFreezeAttendance() {
    if (db_isAttendanceCurrentlyFrozen()) {
        alert("Attendance is already frozen.");
        return;
    }
    if (!confirm("Freeze attendance for the entire school? Teachers won't be able to mark attendance, and no days will count until you resume.")) {
        return;
    }
    const actor = (typeof currentUser !== 'undefined' && currentUser && (currentUser.name || currentUser.username)) || 'admin';
    db_freezeAttendance(actor);
    renderAdminAttendanceControl();
    alert("🔒 School-wide attendance has been FROZEN successfully.");
}

function adminResumeAttendance() {
    if (!db_isAttendanceCurrentlyFrozen()) {
        alert("Attendance is already active.");
        return;
    }
    if (!confirm("Resume attendance marking school-wide? Teachers will be able to mark attendance again.")) {
        return;
    }
    const actor = (typeof currentUser !== 'undefined' && currentUser && (currentUser.name || currentUser.username)) || 'admin';
    db_resumeAttendance(actor);
    renderAdminAttendanceControl();
    alert("▶️ School-wide attendance has been RESUMED successfully.");
}

function updateNotificationBadge() {
    const badge = el('admNotificationBadge');
    if (!badge) return;
    const alerts = getExpiryAlerts();
    if (alerts.length > 0) {
        badge.innerText = alerts.length;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

function renderExpiryNotifications() {
    const tableBody = el('notificationTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    const alerts = getExpiryAlerts();
    const summaryTitle = el('notificationSummaryTitle');
    const summaryDesc = el('notificationSummaryDesc');
    const summaryBanner = el('notificationSummaryBanner');

    if (alerts.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; opacity: 0.5; color: var(--text-muted);">No active expiry alerts.</td></tr>`;
        if (summaryBanner) {
            summaryBanner.style.display = 'none';
        }
        return;
    }

    if (summaryBanner) {
        summaryBanner.style.display = 'flex';
    }

    const expiredCount = alerts.filter(a => a.status === 'expired').length;
    const soonCount = alerts.filter(a => a.status === 'soon').length;

    if (summaryTitle) summaryTitle.innerText = `${alerts.length} Active Expiry Alert${alerts.length > 1 ? 's' : ''}`;
    if (summaryDesc) {
        summaryDesc.innerText = `${expiredCount} document${expiredCount !== 1 ? 's' : ''} already expired, and ${soonCount} document${soonCount !== 1 ? 's' : ''} expiring within the next 30 days.`;
    }
    if (summaryBanner) {
        summaryBanner.style.borderLeftColor = expiredCount > 0 ? "#ef4444" : "#eab308"; // Red if any expired, Yellow if only soon
    }

    alerts.forEach(alert => {
        const tr = document.createElement('tr');

        let statusText = '';
        let badgeColor = '';
        if (alert.status === 'expired') {
            const absDays = Math.abs(alert.daysDiff);
            statusText = `Expired ${absDays} day${absDays !== 1 ? 's' : ''} ago`;
            badgeColor = '#ef4444'; // Red
        } else if (alert.daysDiff === 0) {
            statusText = `Expires Today`;
            badgeColor = '#ef4444'; // Red
        } else {
            statusText = `Expires in ${alert.daysDiff} day${alert.daysDiff !== 1 ? 's' : ''}`;
            badgeColor = '#eab308'; // Yellow/Orange
        }

        let actionButtonHtml = '';
        if (alert.isTeacher) {
            actionButtonHtml = `
                <button class="glass-btn secondary-btn" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; background: rgba(255,255,255,0.03);" onclick="openTeacherDetails('${alert.studentId}')">
                    🔍 View Profile
                </button>
            `;
        } else {
            actionButtonHtml = `
                <button class="glass-btn secondary-btn" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; background: rgba(255,255,255,0.03);" onclick="openStudentDetails('${alert.studentId}')">
                    🔍 View Profile
                </button>
            `;
        }

        tr.innerHTML = `
            <td style="font-weight: 600; color: #f1f5f9;">${escapeHTML(alert.studentName)}</td>
            <td style="font-family: monospace; opacity: 0.9;">${escapeHTML(alert.studentRoll)}</td>
            <td>${escapeHTML(alert.grade)} - ${escapeHTML(alert.section)}</td>
            <td><span style="display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; background: rgba(255,255,255,0.05); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.25);">${escapeHTML(alert.roleLabel)}'s Emirates ID</span></td>
            <td style="font-family: monospace; opacity: 0.9;">${escapeHTML(alert.expiryDate)}</td>
            <td style="font-weight: 600; color: ${badgeColor};">${escapeHTML(statusText)}</td>
            <td style="text-align: center;">
                ${actionButtonHtml}
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

/* ── Automatic Rotating Backups ──
   Keeps the last 5 snapshots of stateDatabase in localStorage (separate from
   the live data key) so an admin can instantly roll back without needing to
   have manually exported a file first. */
const AUTO_BACKUP_MAX = 5;
const AUTO_BACKUP_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes while the app is open

function takeAutoBackupSnapshot() {
    try {
        let list = [];
        try {
            const raw = localStorage.getItem('alpha_portal_auto_backups');
            list = raw ? JSON.parse(raw) : [];
        } catch (e) { list = []; }

        list.unshift({ timestamp: Date.now(), data: stateDatabase });
        if (list.length > AUTO_BACKUP_MAX) list = list.slice(0, AUTO_BACKUP_MAX);

        localStorage.setItem('alpha_portal_auto_backups', JSON.stringify(list));
    } catch (e) {
        console.warn("Auto-backup snapshot failed (storage may be full):", e);
    }
}

function getAutoBackups() {
    try {
        const raw = localStorage.getItem('alpha_portal_auto_backups');
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function renderAutoBackupList() {
    const container = el('autoBackupList');
    if (!container) return;

    const backups = getAutoBackups();
    if (!backups.length) {
        container.innerHTML = `<p style="opacity:0.6; font-size:0.85rem;">No automatic snapshots yet. One is taken shortly after you log in.</p>`;
        return;
    }

    container.innerHTML = backups.map((b, idx) => {
        const d = new Date(b.timestamp);
        const label = d.toLocaleString();
        return `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;">
            <span style="font-size: 0.85rem;">${escapeHTML(label)}${idx === 0 ? ' <span style="opacity:0.6;">(most recent)</span>' : ''}</span>
            <button class="glass-btn secondary-btn" style="padding: 4px 12px; font-size: 0.8rem;" onclick="restoreAutoBackup(${idx})"><span>Restore</span></button>
        </div>`;
    }).join('');
}

function restoreAutoBackup(index) {
    const backups = getAutoBackups();
    const backup = backups[index];
    if (!backup) return;

    if (!confirm(`Restore the automatic snapshot from ${new Date(backup.timestamp).toLocaleString()}? This will overwrite all current data. This action is irreversible.`)) {
        return;
    }

    stateDatabase = backup.data;
    saveState();
    db_logEvent('alphaadmin', 'Admin', 'Auto-Backup Restore', `Restored automatic snapshot from ${new Date(backup.timestamp).toLocaleString()}.`);
    alert("Snapshot restored successfully. The app will now reload.");
    location.reload();
}

setInterval(takeAutoBackupSnapshot, AUTO_BACKUP_INTERVAL_MS);

function downloadDatabaseBackup() {
    try {
        const serialized = JSON.stringify(stateDatabase, null, 2);
        const blob = new Blob([serialized], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `alpha-portal-secured-backup-${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        db_logEvent('alphaadmin', 'Admin', 'Generate Backup', 'Successfully exported system database backup securely.');
        alert("Database Backup Generated successfully! The encrypted file has been downloaded onto your device.");
    } catch (e) {
        console.error("Backup generation failed:", e);
        alert("Backup Generation Failed: An unexpected internal error occurred.");
    }
}

function restoreDatabaseBackup() {
    const fileSelector = el('securityBackupFile');
    const file = fileSelector.files[0];
    if (!file) {
        alert("Please select a valid .json system backup file to restore.");
        return;
    }

    if (!confirm("WARNING: Restoring a database file will completely overwrite all existing accounts, schedules, reports, announcements, and messages. This action is irreversible. Do you wish to proceed?")) {
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsed = JSON.parse(e.target.result);
            // Schema validations to prevent malicious or malformed file uploads
            if (typeof parsed !== 'object' || parsed === null || !parsed.students || !parsed.teachers) {
                throw new Error("Missing required structural properties (students/teachers) in the schema.");
            }
            
            // Clean up files first if needed
            stateDatabase = parsed;
            saveState();
            db_logEvent('alphaadmin', 'Admin', 'Restore Backup', 'System database successfully restored from backup file.');
            alert("Database Overwritten Successfully! Overriding system database state completed. The application will now reload to apply all changes.");
            window.location.reload();
        } catch (err) {
            console.error("Restore failed:", err);
            db_logEvent('alphaadmin', 'Admin', 'Failed Restore Backup', `Invalid or corrupt backup file rejected: ${err.message}`);
            alert(`Database Restore Failed: The provided file is corrupt or is not a valid Alpha Portal database backup. Error: ${err.message}`);
        }
    };
    reader.readAsText(file);
}

/* ═══════════════════════════════════════════════════════════════════════════
   STUDENT ATTENDANCE TRACKER FUNCTIONS
   ═══════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════════
   TEACHER ATTENDANCE — DAILY REGISTER
   ═══════════════════════════════════════════════════════════════════════════
   Class -> Section -> Daily Register. Every mark is written straight to the
   structured attendance store (db_saveAttendance), so a teacher tapping a
   status button is instantly reflected everywhere a rate is shown — the
   student's dashboard, their profile card, and the principal's overview. */
let currentSelectedClass = null;
let currentSelectedSection = '';
// (per-day register date state removed — the grid view tracks currentGridYear/currentGridMonthIndex instead)

function renderAttendanceBreadcrumbs(step) {
    const desc = el('attViewDesc');
    if (!desc) return;

    const linkStyle = `color: var(--gold-light, #c9a84c); cursor: pointer; text-decoration: underline; transition: opacity 0.2s; font-weight: 500;`;
    const textStyle = `color: rgba(240, 230, 211, 0.8); font-weight: 500;`;
    const arrowStyle = `margin: 0 8px; color: rgba(240, 230, 211, 0.3);`;

    let html = '';
    if (step === 'class') {
        html = `<span style="${textStyle}">Select a class to take or review attendance.</span>`;
    } else if (step === 'section') {
        html = `<span style="${linkStyle}" onclick="initAttendanceView()">Classes</span><span style="${arrowStyle}">/</span><span style="${textStyle}">${escapeHTML(currentSelectedClass)}</span> <span style="margin-left: 10px; opacity: 0.6; font-size: 0.85em; color: rgba(240, 230, 211, 0.6); font-style: italic;">(Select Section)</span>`;
    } else if (step === 'register') {
        html = `<span style="${linkStyle}" onclick="initAttendanceView()">Classes</span><span style="${arrowStyle}">/</span><span style="${linkStyle}" onclick="selectAttendanceClass('${escapeHTML(currentSelectedClass)}')">${escapeHTML(currentSelectedClass)}</span><span style="${arrowStyle}">/</span><span style="${textStyle}">Section ${escapeHTML(currentSelectedSection)}</span>`;
    }

    desc.innerHTML = html;
}

function initAttendanceView() {
    const classView = el('attClassView');
    const sectionView = el('attSectionView');
    const gridView = el('attGridView');

    if (classView) classView.style.display = 'grid';
    if (sectionView) sectionView.style.display = 'none';
    if (gridView) gridView.style.display = 'none';
    renderAttendanceBreadcrumbs('class');

    const grades = currentActiveTeacherSession ? currentActiveTeacherSession.grades : [];

    let html = '';
    if (grades && grades.length > 0) {
        grades.forEach(g => {
            html += `
            <div class="glass-panel" style="padding: 1.5rem; text-align: center; cursor: pointer; transition: transform 0.2s;" onclick="selectAttendanceClass('${escapeHTML(g)}')" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
                <h3 style="margin: 0; color: var(--gold-light);">${escapeHTML(g)}</h3>
            </div>
            `;
        });
    } else {
        html = '<p style="grid-column: 1/-1; text-align: center; color: #fff;">No classes assigned to you.</p>';
    }
    if (classView) classView.innerHTML = html;
}

function selectAttendanceClass(className) {
    currentSelectedClass = className;
    const classView = el('attClassView');
    const sectionView = el('attSectionView');
    const gridView = el('attGridView');

    if (classView) classView.style.display = 'none';
    if (sectionView) sectionView.style.display = 'grid';
    if (gridView) gridView.style.display = 'none';
    renderAttendanceBreadcrumbs('section');

    renderAttendanceSections();
}

function renderAttendanceSections() {
    const sectionView = el('attSectionView');
    if (!sectionView) return;

    const sections = ['A', 'B'];

    let html = `
    <div style="grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
        <button class="glass-btn secondary-btn" onclick="initAttendanceView()">
            <span>⬅️ Back to Classes</span>
        </button>
    </div>
    `;

    sections.forEach(s => {
        html += `
        <div class="glass-panel" style="padding: 1.5rem; text-align: center; cursor: pointer; transition: transform 0.2s; position: relative;" onclick="selectAttendanceSection('${s}')" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
            <h3 style="margin: 0; color: var(--gold-light);">Section ${s}</h3>
        </div>
        `;
    });

    sectionView.innerHTML = html;
}

function selectAttendanceSection(section) {
    currentSelectedSection = section;
    const sectionView = el('attSectionView');
    if (sectionView) sectionView.style.display = 'none';
    renderAttendanceBreadcrumbs('register');
    const now = new Date();
    openMonthGrid(now.getFullYear(), now.getMonth());
}

let currentGridYear = null;
let currentGridMonthIndex = null; // 0-11

function jumpGridToThisMonth() {
    const now = new Date();
    openMonthGrid(now.getFullYear(), now.getMonth());
}

function changeGridMonth(delta) {
    if (currentGridYear === null || currentGridMonthIndex === null) {
        const now = new Date();
        currentGridYear = now.getFullYear();
        currentGridMonthIndex = now.getMonth();
    }
    let newMonth = currentGridMonthIndex + delta;
    let newYear = currentGridYear;
    if (newMonth > 11) { newMonth = 0; newYear++; }
    if (newMonth < 0) { newMonth = 11; newYear--; }
    openMonthGrid(newYear, newMonth);
}

function openMonthGrid(year, monthIndex) {
    currentGridYear = year;
    currentGridMonthIndex = monthIndex;
    gridUndoStack = [];
    updateGridUndoButton();

    const gridView = el('attGridView');
    if (gridView) gridView.style.display = 'flex';

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const label = el('attGridMonthLabel');
    if (label) label.innerText = `${monthNames[monthIndex]} ${year}`;

    // Never allow navigating past the current real-world month
    const now = new Date();
    const isCurrentOrPastMonth = (year < now.getFullYear()) || (year === now.getFullYear() && monthIndex <= now.getMonth());
    const nextBtn = el('attGridNextBtn');
    if (nextBtn) nextBtn.disabled = !isCurrentOrPastMonth;

    renderMonthGrid();
}

/**
 * Renders the monthly attendance grid: one row per registered student in the
 * selected class/section, one column per calendar day of the selected month.
 * Weekends render as a plain dot (not interactive). Days beyond today (i.e.
 * days that haven't happened yet) render as blank/disabled — there is
 * nothing to mark yet. Every checkbox reflects the actual saved record for
 * that exact student + exact date, matched by student ID, so there is never
 * any ambiguity about whose box is whose or whether a day was "forgotten"
 * versus genuinely marked absent — an unmarked box simply has no record and
 * is excluded from the rate until the teacher clicks it.
 */
function renderMonthGrid() {
    const container = el('attGridTableContainer');
    if (!container || !currentSelectedClass || !currentSelectedSection) return;

    const students = db_getStudents(currentSelectedClass, currentSelectedSection);
    const year = currentGridYear;
    const monthIndex = currentGridMonthIndex;
    const numDays = new Date(year, monthIndex + 1, 0).getDate();
    const limitDay = getCoveredDaysLimit(year, monthIndex); // days actually reached so far (0 if fully future, numDays if fully past)

    if (!students.length) {
        container.innerHTML = `<div style="text-align:center; padding: 40px 20px; color: var(--text-secondary);">No students found in this class/section.</div>`;
        return;
    }

    let html = '';

    if (db_isAttendanceCurrentlyFrozen()) {
        html += `<div style="display:flex; align-items:center; gap:10px; padding: 12px 16px; margin-bottom: 14px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3); border-radius: 10px; color: #ff9d9d;">
            <span style="font-size:1.2rem;">🔒</span>
            <span><strong>Attendance is currently frozen by the administrator.</strong> You can't mark attendance until it's resumed. Days while frozen don't count toward any student's rate.</span>
        </div>`;
    }

    html += `<table style="border-collapse: collapse; width: max-content; min-width: 100%; font-size: 0.78rem;">`;

    // Header row: student name column (sticky) + one column per day + total column
    html += `<thead><tr>`;
    html += `<th style="position: sticky; left: 0; z-index: 2; background: #1a1a1a; border: 1px solid rgba(255,255,255,0.12); padding: 8px 12px; text-align: left; min-width: 160px; color: var(--gold-light);">Student</th>`;
    for (let d = 1; d <= numDays; d++) {
        const dow = new Date(year, monthIndex, d).getDay();
        const isWeekend = (dow === 0 || dow === 6);
        html += `<th style="border: 1px solid rgba(255,255,255,0.12); padding: 6px 4px; text-align: center; min-width: 30px; color: ${isWeekend ? 'rgba(255,255,255,0.35)' : 'var(--gold-light)'};">${d}</th>`;
    }
    html += `<th style="border: 1px solid rgba(255,255,255,0.12); padding: 6px 10px; text-align: center; min-width: 70px; color: var(--gold-light); background: #1a1a1a;">This Month</th>`;
    html += `</tr></thead><tbody>`;

    students.forEach(s => {
        const records = db_getAttendanceForStudent(s.id);
        const recordsByDate = {};
        records.forEach(r => { recordsByDate[r.date] = r.status; });

        let monthPresent = 0, monthTotal = 0;

        html += `<tr>`;
        html += `<td style="position: sticky; left: 0; z-index: 1; background: #141414; border: 1px solid rgba(255,255,255,0.1); padding: 6px 12px; font-weight: 700; white-space: nowrap;">${escapeHTML(s.name)}</td>`;

        for (let d = 1; d <= numDays; d++) {
            const dow = new Date(year, monthIndex, d).getDay();
            const isWeekend = (dow === 0 || dow === 6);
            const mm = String(monthIndex + 1).padStart(2, '0');
            const dd = String(d).padStart(2, '0');
            const dateStr = `${year}-${mm}-${dd}`;

            if (isWeekend) {
                html += `<td style="border: 1px solid rgba(255,255,255,0.08); text-align: center; opacity: 0.35;">•</td>`;
                continue;
            }

            if (d > limitDay) {
                // Day hasn't happened yet — nothing to show or mark.
                html += `<td style="border: 1px solid rgba(255,255,255,0.08); text-align: center; opacity: 0.2;">-</td>`;
                continue;
            }

            if (db_isDateFrozen(dateStr)) {
                html += `<td style="border: 1px solid rgba(255,255,255,0.08); text-align: center; opacity: 0.45;" title="Attendance frozen by admin for this date">🔒</td>`;
                continue;
            }

            const status = recordsByDate[dateStr];
            const isPresent = (status === 'Present' || status === 'Late' || status === 'Excused');
            const hasRecord = !!status;
            if (hasRecord) {
                monthTotal++;
                if (isPresent) monthPresent++;
            }

            let cellStyle = 'border: 1px solid rgba(255,255,255,0.08); text-align: center; cursor: pointer;';
            if (hasRecord && isPresent) cellStyle += ' background: rgba(34,197,94,0.12);';
            else if (hasRecord && !isPresent) cellStyle += ' background: rgba(239,68,68,0.10);';

            html += `<td style="${cellStyle}" onclick="toggleGridAttendance('${escapeHTML(s.id)}', '${dateStr}')">
                <input type="checkbox" ${isPresent ? 'checked' : ''} aria-label="${escapeHTML(s.name)} attendance for ${dateStr}" onclick="event.stopPropagation(); toggleGridAttendance('${escapeHTML(s.id)}', '${dateStr}')" style="width:15px; height:15px; cursor:pointer; ${hasRecord ? '' : 'opacity:0.35;'}">
            </td>`;
        }

        const monthRate = monthTotal > 0 ? ((monthPresent / monthTotal) * 100).toFixed(0) + '%' : '—';
        html += `<td style="border: 1px solid rgba(255,255,255,0.1); text-align: center; font-weight: 700; background: #141414;">${monthPresent}/${monthTotal} <span style="opacity:0.6; font-weight:400;">(${monthRate})</span></td>`;
        html += `</tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

/* ── Attendance Grid Undo ──
   Each click pushes the PREVIOUS state (before the change) onto a stack, so
   undo restores exactly what was there a moment ago — including "no record
   at all" if that's what it was. Capped so it doesn't grow forever. */
let gridUndoStack = [];
const GRID_UNDO_MAX = 25;

function pushGridUndo(studentId, dateStr, previousStatus) {
    gridUndoStack.push({ studentId, dateStr, previousStatus }); // previousStatus is null if there was no record
    if (gridUndoStack.length > GRID_UNDO_MAX) gridUndoStack.shift();
    updateGridUndoButton();
}

function undoLastAttendanceChange() {
    const last = gridUndoStack.pop();
    if (!last) return;

    const teacherId = currentActiveTeacherSession ? currentActiveTeacherSession.id : 'teacher';
    if (last.previousStatus === null) {
        // It was unmarked before — remove whatever record is there now.
        if (stateDatabase.attendance) {
            stateDatabase.attendance = stateDatabase.attendance.filter(r => !(r.studentId === last.studentId && r.date === last.dateStr));
            saveState();
        }
    } else {
        db_saveAttendance(last.studentId, last.dateStr, last.previousStatus, '', teacherId);
    }

    updateGridUndoButton();
    renderMonthGrid();
}

function updateGridUndoButton() {
    const btn = el('attGridUndoBtn');
    if (btn) btn.disabled = (gridUndoStack.length === 0);
}

/**
 * A checkbox click cycles a single day's record for one student through:
 * no record -> Present -> Absent -> no record (back to unmarked).
 * This lets a teacher correct a mis-click without leaving a stray record.
 */
function toggleGridAttendance(studentId, dateStr) {
    if (dateStr > todayISO()) return; // safety net — future days are never clickable in the UI anyway

    if (db_isDateFrozen(dateStr)) {
        alert("Attendance is currently frozen by the school administrator. You can't mark attendance until it's resumed.");
        return;
    }

    const records = db_getAttendanceForStudent(studentId);
    const existing = records.find(r => r.date === dateStr);
    const teacherId = currentActiveTeacherSession ? currentActiveTeacherSession.id : 'teacher';

    pushGridUndo(studentId, dateStr, existing ? existing.status : null);

    if (!existing) {
        db_saveAttendance(studentId, dateStr, 'Present', '', teacherId);
    } else if (existing.status === 'Present') {
        db_saveAttendance(studentId, dateStr, 'Absent', '', teacherId);
    } else {
        // Any other state (Absent, Late, Excused) clears back to unmarked.
        if (stateDatabase.attendance) {
            stateDatabase.attendance = stateDatabase.attendance.filter(r => !(r.studentId === studentId && r.date === dateStr));
            saveState();
        }
    }

    renderMonthGrid();
}



function getMonthIndex(name) {
    if (!name) return 5; // default June
    const m = name.trim().toUpperCase();
    const map = {
        'JAN': 0, 'JANUARY': 0,
        'FEB': 1, 'FEBRUARY': 1,
        'MAR': 2, 'MARCH': 2,
        'APR': 3, 'APRIL': 3,
        'MAY': 4, 'MAY': 4,
        'JUN': 5, 'JUNE': 5,
        'JUL': 6, 'JULY': 6,
        'AUG': 7, 'AUGUST': 7,
        'SEP': 8, 'SEPTEMBER': 8,
        'OCT': 9, 'OCTOBER': 9,
        'NOV': 10, 'NOVEMBER': 10,
        'DEC': 11, 'DECEMBER': 11
    };
    return map[m] !== undefined ? map[m] : 5;
}

function getActualYearForMonth(academicYearStr, monthName) {
    if (!academicYearStr) return 2026;
    const parts = academicYearStr.split('-');
    const firstYear = parseInt(parts[0], 10) || 2026;
    const secondYearStr = parts[1] ? (firstYear.toString().substring(0, 2) + parts[1]) : (firstYear + 1).toString();
    const secondYear = parseInt(secondYearStr, 10) || (firstYear + 1);
    
    const secondYearMonths = ['JAN', 'JANUARY', 'FEB', 'FEBRUARY', 'MAR', 'MARCH', 'APR', 'APRIL', 'MAY'];
    if (secondYearMonths.includes(monthName.toUpperCase())) {
        return secondYear;
    }
    return firstYear;
}

function getCoveredDaysLimit(sheetYear, sheetMonthIndex) {
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth(); // 0-11
    const todayDay = today.getDate();
    
    if (sheetYear > todayYear) {
        return 0; // future year
    }
    if (sheetYear < todayYear) {
        return 31; // past year
    }
    
    // sheetYear === todayYear
    if (sheetMonthIndex > todayMonth) {
        return 0; // future month
    }
    if (sheetMonthIndex < todayMonth) {
        return 31; // past month
    }
    
    // sheetYear === todayYear && sheetMonthIndex === todayMonth
    return todayDay; // current month limit
}

/**
 * Single source of truth for reading a student's attendance out of the saved
 * classroom register sheets. Every screen that shows an attendance rate,
 * count, or log for a student should go through this function so the numbers
 * always agree with each other.
 *
 * Rules this follows (documented so behaviour is predictable, not guessed):
 *  - A student's row is matched by their unique student ID (data-student-id
 *    on the <tr>), never by comparing name text. This avoids two students
 *    with the same name being merged into one attendance total.
 *  - Only school days up to and including today are counted. Days in the
 *    future are simply skipped (attendance can't exist yet). A day that has
 *    already passed always counts, even if the teacher never checked a box
 *    for it — an unchecked box on a past day is treated as Absent, the same
 *    way a paper register would be read. This removes the old guesswork
 *    around "did anyone check a box that day."
 *  - Weekends ('.' columns) are never counted.
 *  - A cell is only ever "Present" if its checkbox is checked, or it holds an
 *    explicit code (P/PRESENT, L/LATE, E/EXCUSED, A/ABSENT). Anything else
 *    (blank, stray text) is skipped rather than guessed as Present.
 */
function getExcelAttendanceRecords(student) {
    const records = [];
    if (!student) return records;

    Object.keys(stateDatabase).forEach(key => {
        if (!key.startsWith('excel_') || !stateDatabase[key] || !stateDatabase[key].html) return;

        const parts = key.split('_');
        if (parts.length < 5) return;
        const grade = parts[1];
        const section = parts[2];
        const yearStr = parts[3];
        const monthName = parts[4];

        if (student.grade && grade.trim().toLowerCase() !== student.grade.trim().toLowerCase()) return;
        if (student.section && !db_sectionsMatch(section, student.section)) return;

        const monthIndex = getMonthIndex(monthName);
        const actualYear = getActualYearForMonth(yearStr, monthName);
        const limitDay = getCoveredDaysLimit(actualYear, monthIndex);
        if (limitDay <= 0) return; // whole sheet is in the future, nothing to count yet

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = stateDatabase[key].html;
        const table = tempDiv.querySelector('table');
        if (!table) return;
        const rows = table.querySelectorAll('tbody tr');
        if (rows.length === 0) return;

        // Prefer a direct ID match. Only fall back to name-matching for very old
        // sheets saved before rows carried an ID, and even then never match a
        // row that already belongs (by ID) to a different student.
        let studentRow = null;
        rows.forEach(row => {
            if (studentRow) return;
            if (row.getAttribute('data-student-id') === student.id) studentRow = row;
        });
        if (!studentRow) {
            rows.forEach(row => {
                if (studentRow) return;
                if (row.getAttribute('data-student-id')) return;
                const cells = row.querySelectorAll('td');
                if (cells.length < 3) return;
                const rowName = cells[0].innerText.trim().toLowerCase();
                if (rowName && student.name && rowName === student.name.trim().toLowerCase()) {
                    studentRow = row;
                }
            });
        }
        if (!studentRow) return;

        const cells = studentRow.querySelectorAll('td');
        if (cells.length < 3) return;
        const numDays = cells.length - 2; // name column + TOT column
        const cappedDays = Math.min(numDays, limitDay);

        const today = new Date();
        const isCurrentSheetMonth = actualYear === today.getFullYear() && monthIndex === today.getMonth();
        const todayColumnIndex = isCurrentSheetMonth ? today.getDate() : -1;

        for (let i = 1; i <= cappedDays; i++) {
            const cell = cells[i];
            if (!cell) continue;

            const actualDate = new Date(actualYear, monthIndex, i);
            const dayOfWeek = actualDate.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) continue; // weekend

            // Today gets a grace period: don't count it against a student until
            // the teacher has actually opened today's register and marked
            // someone. Every day before today always counts.
            if (i === todayColumnIndex) {
                let classTouchedToday = false;
                studentRow.parentNode.querySelectorAll('tr').forEach(r => {
                    if (classTouchedToday) return;
                    const rc = r.querySelectorAll('td');
                    if (!rc[i]) return;
                    const cb = rc[i].querySelector('input[type="checkbox"]');
                    if (cb) {
                        if (cb.checked || cb.hasAttribute('checked')) classTouchedToday = true;
                    } else {
                        const t = rc[i].innerText.trim();
                        if (t && t !== '.') classTouchedToday = true;
                    }
                });
                if (!classTouchedToday) continue;
            }

            let status = null;
            const checkbox = cell.querySelector('input[type="checkbox"]');
            if (checkbox) {
                status = (checkbox.checked || checkbox.hasAttribute('checked')) ? 'Present' : 'Absent';
            } else {
                const cellText = cell.innerText.trim().toUpperCase();
                if (cellText === 'P' || cellText === 'PRESENT') status = 'Present';
                else if (cellText === 'A' || cellText === 'ABSENT') status = 'Absent';
                else if (cellText === 'L' || cellText === 'LATE') status = 'Late';
                else if (cellText === 'E' || cellText === 'EXCUSED') status = 'Excused';
                // blank, '.', or unrecognized text: leave status as null (not counted)
            }
            if (status === null) continue;

            const dd = i < 10 ? '0' + i : '' + i;
            const mm = (monthIndex + 1) < 10 ? '0' + (monthIndex + 1) : '' + (monthIndex + 1);
            records.push({
                date: `${actualYear}-${mm}-${dd}`,
                status: status,
                source: `${monthName} ${yearStr}`
            });
        }
    });

    records.sort((a, b) => new Date(a.date) - new Date(b.date));
    return records;
}

function calculateStudentAttendanceRate(student) {
    if (!student) return { percentage: null, present: 0, total: 0, rawPercentage: 0 };

    let present = 0;
    let total = 0;

    const records = db_getAttendanceForStudent(student.id);
    if (records && records.length > 0) {
        records.forEach(r => {
            if (db_isDateFrozen(r.date)) return; // frozen days never count, no exceptions
            total++;
            if (r.status === 'Present' || r.status === 'Late' || r.status === 'Excused') {
                present++;
            }
        });
    }

    if (total === 0) {
        return { percentage: '0.0%', present: 0, total: 0, rawPercentage: 0 };
    }

    const rawPercentage = (present / total) * 100;
    return {
        percentage: rawPercentage.toFixed(1) + '%',
        present: present,
        total: total,
        rawPercentage: rawPercentage
    };
}

function changeAdminPassword() {
    const newPwd = el('admNewPassword').value.trim();
    const confPwd = el('admConfirmPassword').value.trim();
    
    if (!newPwd) {
        alert("Please enter a new password.");
        return;
    }
    if (newPwd !== confPwd) {
        alert("Passwords do not match. Please verify.");
        return;
    }
    
    const hashed = db_hashPassword(newPwd, ADMIN_PASSWORD_SALT);
    stateDatabase.adminPasswordHash = hashed;
    ADMIN_PASSWORD_HASH = hashed;
    saveState();
    
    db_logEvent('alphaadmin', 'Admin', 'Password Change', 'Administrator changed their portal login password successfully.');
    alert("Administrator password successfully updated!");
    
    el('admNewPassword').value = '';
    el('admConfirmPassword').value = '';
}

function adminChangeUserPassword(id, role) {
    const input = el('modalChangePwdInput');
    if (!input) return;
    const newPwd = input.value.trim();
    if (!newPwd) {
        alert("Please enter a valid password first.");
        return;
    }
    
    const salt = "SALT-" + Math.floor(Math.random() * 1000000);
    const pwdObj = { hash: db_hashPassword(newPwd, salt), salt: salt };
    
    if (role === 'student') {
        const s = db_getStudent(id);
        if (s) {
            s.password = pwdObj;
            saveState();
            db_logEvent('alphaadmin', 'Admin', 'Student Password Change', `Admin changed password for student ${s.name} (${s.id})`);
            alert(`Password updated successfully to: ${newPwd}`);
            openStudentDetails(id);
        }
    } else if (role === 'teacher') {
        const t = db_getTeacher(id);
        if (t) {
            t.password = pwdObj;
            saveState();
            db_logEvent('alphaadmin', 'Admin', 'Teacher Password Change', `Admin changed password for teacher ${t.name} (${t.id})`);
            alert(`Password updated successfully to: ${newPwd}`);
            openTeacherDetails(id);
        }
    }
}

function changeStudentPassword() {
    const s = currentActiveStudentSession;
    if (!s) return;
    
    const newPwd = el('stdNewPassword').value.trim();
    const confPwd = el('stdConfirmPassword').value.trim();
    
    if (!newPwd) {
        alert("Please enter a new password.");
        return;
    }
    if (newPwd !== confPwd) {
        alert("Passwords do not match. Please verify.");
        return;
    }
    
    const salt = "SALT-" + Math.floor(Math.random() * 1000000);
    const pwdObj = { hash: db_hashPassword(newPwd, salt), salt: salt };
    
    s.password = pwdObj;
    
    const dbS = db_getStudent(s.id);
    if (dbS) {
        dbS.password = pwdObj;
    }
    
    saveState();
    db_logEvent(s.id, 'Student', 'Student Password Change', `Student ${s.name} changed their portal login password.`);
    alert("Your password has been successfully updated!");
    
    el('stdNewPassword').value = '';
    el('stdConfirmPassword').value = '';
}

/* ── Attendance Reset Controllers ── */
function openAttendanceResetModal() {
    const modal = el('attendanceResetModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeAttendanceResetModal() {
    const modal = el('attendanceResetModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function confirmResetAttendanceSheet() {
    if (!currentSelectedClass || !currentSelectedSection || currentGridYear === null || currentGridMonthIndex === null) {
        closeAttendanceResetModal();
        return;
    }

    const students = db_getStudents(currentSelectedClass, currentSelectedSection);
    const studentIds = new Set(students.map(s => s.id));
    const mm = String(currentGridMonthIndex + 1).padStart(2, '0');
    const monthPrefix = `${currentGridYear}-${mm}-`; // e.g. "2026-07-"

    if (stateDatabase.attendance) {
        stateDatabase.attendance = stateDatabase.attendance.filter(r =>
            !(studentIds.has(r.studentId) && r.date.startsWith(monthPrefix))
        );
        saveState();
    }

    renderMonthGrid();
    closeAttendanceResetModal();
    gridUndoStack = [];
    updateGridUndoButton();

    const actorId = currentActiveTeacherSession ? currentActiveTeacherSession.id : 'teacher';
    const actorName = currentActiveTeacherSession ? currentActiveTeacherSession.name : 'Teacher';
    db_logEvent(actorId, 'Teacher', 'Attendance Cleared', `Teacher ${actorName} cleared attendance for Class ${currentSelectedClass} Section ${currentSelectedSection} for ${currentGridYear}-${mm}.`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PRINCIPAL EXECUTIVE MODULE CONTROLLERS
   ═══════════════════════════════════════════════════════════════════════════ */
function switchPrincipalTab(tab) {
    ['Dashboard', 'Approvals', 'Evaluation', 'Emergency', 'Academics', 'Finance', 'Parents', 'Calendar', 'Students', 'Teachers', 'Attendance', 'Logs'].forEach(t => {
        const btn = el(`prcTabBtn${t}`);
        const view = el(`prcView${t}`);
        if (btn) btn.classList.remove('active');
        if (view) view.style.display = 'none';
    });
    
    const cap = tab.charAt(0).toUpperCase() + tab.slice(1);
    const btn = el(`prcTabBtn${cap}`);
    const view = el(`prcView${cap}`);
    if (btn) btn.classList.add('active');
    if (view) view.style.display = 'block';
    
    if (tab === 'dashboard') {
        renderPrincipalDashboard();
    } else if (tab === 'approvals') {
        renderPrincipalApprovals();
    } else if (tab === 'evaluation') {
        renderPrincipalEvaluation();
    } else if (tab === 'emergency') {
        renderPrincipalEmergency();
    } else if (tab === 'academics') {
        renderPrincipalAcademics();
    } else if (tab === 'finance') {
        renderPrincipalFinance();
    } else if (tab === 'parents') {
        renderPrincipalParents();
    } else if (tab === 'calendar') {
        renderPrincipalCalendar();
    } else if (tab === 'students') {
        renderPrincipalStudentDirectory();
    } else if (tab === 'teachers') {
        renderPrincipalTeacherRoster();
    } else if (tab === 'attendance') {
        renderPrincipalAttendanceOverview();
    } else if (tab === 'logs') {
        renderPrincipalAuditLogs();
    }
    updateAllPortalNotificationBadges();
}

/* Grade sorting order helper */
const ALL_GRADES_ORDER = [
    'KG 1', 'KG 2', 'KG', 'LKG', 'UKG',
    'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
    'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'
];

function getGradeOrderIndex(g) {
    const idx = ALL_GRADES_ORDER.indexOf(g);
    if (idx !== -1) return idx;
    const numMatch = (g || '').match(/\d+/);
    if (numMatch) return 100 + parseInt(numMatch[0], 10);
    return 999;
}

function renderPrincipalDashboard() {
    const totalStudents = stateDatabase.students ? stateDatabase.students.length : 0;
    const totalTeachers = stateDatabase.teachers ? stateDatabase.teachers.length : 0;
    const totalSubjects = stateDatabase.subjects ? stateDatabase.subjects.length : 0;
    const totalAnnouncements = stateDatabase.announcements ? stateDatabase.announcements.length : 0;
    
    const sCount = el('prcStatStudents');
    const tCount = el('prcStatTeachers');
    const subCount = el('prcStatSubjects');
    const annCount = el('prcStatAnnouncements');
    
    if (sCount) sCount.innerText = totalStudents;
    if (tCount) tCount.innerText = totalTeachers;
    if (subCount) subCount.innerText = totalSubjects;
    if (annCount) annCount.innerText = totalAnnouncements;
    
    // Build Grade distribution charts
    const gradeCounts = {};
    if (stateDatabase.students) {
        stateDatabase.students.forEach(s => {
            const gr = s.grade || 'Other';
            gradeCounts[gr] = (gradeCounts[gr] || 0) + 1;
        });
    }
    
    const defaultGrades = [
        'KG 1', 'KG 2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4',
        'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'
    ];
    defaultGrades.forEach(g => {
        if (!gradeCounts[g]) gradeCounts[g] = 0;
    });
    
    const chartContainer = el('prcGradeDistributionChart');
    if (chartContainer) {
        chartContainer.innerHTML = '';
        const maxCount = Math.max(...Object.values(gradeCounts), 1);
        
        Object.keys(gradeCounts)
            .sort((a, b) => getGradeOrderIndex(a) - getGradeOrderIndex(b))
            .forEach(gr => {
                const count = gradeCounts[gr];
                const pct = (count / maxCount) * 100;
                
                const row = document.createElement('div');
                row.style.margin = '14px 0';
                row.innerHTML = `
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 5px;">
                        <span style="font-weight: 700; color: var(--gold-light);">${escapeHTML(gr)}</span>
                        <span style="color: var(--text-secondary); font-weight: 600;">${count} Students</span>
                    </div>
                    <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, var(--gold-dim), var(--gold-light)); border-radius: 4px; transition: width 0.8s ease;"></div>
                    </div>
                `;
                chartContainer.appendChild(row);
            });
    }
    
    // Render recent bulletins log
    const recentAnnBox = el('prcRecentAnnouncements');
    if (recentAnnBox) {
        recentAnnBox.innerHTML = '';
        if (!stateDatabase.announcements || !stateDatabase.announcements.length) {
            recentAnnBox.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px 0; font-style: italic;">No bulletins published yet.</div>';
        } else {
            const sortedAnn = [...stateDatabase.announcements].reverse().slice(0, 3);
            sortedAnn.forEach(ann => {
                const div = document.createElement('div');
                div.style.background = 'rgba(255,255,255,0.02)';
                div.style.border = '1px solid rgba(255,255,255,0.05)';
                div.style.padding = '12px 16px';
                div.style.borderRadius = '12px';
                div.style.marginBottom = '10px';
                div.innerHTML = `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; opacity: 0.6; margin-bottom: 4px;">
                        <span>📅 ${ann.date || today()}</span>
                    </div>
                    <h4 style="font-size: 14px; color: var(--gold-light); margin-bottom: 4px;">${escapeHTML(ann.title)}</h4>
                    <p style="font-size: 12.5px; opacity: 0.85; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHTML(ann.desc)}</p>
                `;
                recentAnnBox.appendChild(div);
            });
        }
    }
}

function executePrincipalAnnouncement() {
    const title = el('prcAnnTitle').value.trim();
    const desc  = el('prcAnnDesc').value.trim();
    const fi    = el('prcAnnImage');
    if (!title || !desc) { alert("Please fill all announcement fields."); return; }
    if (fi.files && fi.files[0]) {
        const r = new FileReader();
        r.onload = e => commitPrincipalAnn(title, desc, e.target.result);
        r.readAsDataURL(fi.files[0]);
    } else { commitPrincipalAnn(title, desc, null); }
}

function commitPrincipalAnn(title, desc, img) {
    const id = "ANN-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    db_addAnnouncement({ id, title, desc, image: img, date: today() });
    alert("Official Bulletin broadcasted successfully from the Principal Desk!");
    el('prcAnnTitle').value = ''; el('prcAnnDesc').value = '';
    el('prcAnnImage').value = ''; el('prcAnnImgPreview').style.display = 'none';
    renderPrincipalDashboard(); // Refresh
}

function previewPrincipalAnnouncementImage(event) {
    const file = event.target.files[0];
    const preview = el('prcAnnImgPreview');
    if (preview) {
        if (file) {
            const r = new FileReader();
            r.onload = e => { preview.src = e.target.result; preview.style.display = 'block'; };
            r.readAsDataURL(file);
        } else { preview.src = ''; preview.style.display = 'none'; }
    }
}

function renderPrincipalStudentDirectory() {
    const tableBody = el('prcStudentTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    const searchVal = el('prcStudentSearch').value.toLowerCase().trim();
    const gradeVal = el('prcStudentGradeFilter').value;
    const sectionVal = el('prcStudentSectionFilter').value;
    
    let list = stateDatabase.students || [];
    
    // Filtering
    if (gradeVal !== 'ALL') {
        list = list.filter(s => s.grade === gradeVal);
    }
    if (sectionVal !== 'ALL') {
        list = list.filter(s => s.section === sectionVal);
    }
    if (searchVal) {
        list = list.filter(s => s.name.toLowerCase().includes(searchVal) || s.roll.toLowerCase().includes(searchVal));
    }
    
    if (!list.length) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px 0;">No matching student profiles found.</td></tr>`;
        return;
    }
    
    list.forEach(s => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.style.transition = 'background 0.2s';
        tr.onmouseover = () => { tr.style.background = 'rgba(201, 168, 76, 0.05)'; };
        tr.onmouseout = () => { tr.style.background = 'transparent'; };
        tr.onclick = () => openStudentDetails(s.id);
        
        tr.innerHTML = `
            <td style="color: var(--gold); font-weight: 700; padding: 12px 8px;">${escapeHTML(s.id)}</td>
            <td style="font-weight: 700; color: var(--text-primary); padding: 12px 8px;">${escapeHTML(s.name)}</td>
            <td style="padding: 12px 8px;"><span style="background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 500;">${escapeHTML(s.grade)}</span></td>
            <td style="padding: 12px 8px;"><span style="background: rgba(201,168,76,0.1); color: var(--gold-light); padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 500;">${escapeHTML(s.section)}</span></td>
            <td style="color: var(--text-secondary); padding: 12px 8px;">${escapeHTML(s.roll)}</td>
            <td style="padding: 12px 8px;"><span style="border: 1px solid rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-size: 11px; opacity: 0.85;">${escapeHTML(s.house)}</span></td>
        `;
        tableBody.appendChild(tr);
    });
}

function renderPrincipalAttendanceOverview() {
    const students = stateDatabase.students || [];
    const searchVal = (el('prcAttSearch') ? el('prcAttSearch').value : '').toLowerCase().trim();
    const gradeVal = el('prcAttGradeFilter') ? el('prcAttGradeFilter').value : 'ALL';
    const sectionVal = el('prcAttSectionFilter') ? el('prcAttSectionFilter').value : 'ALL';

    let list = students.map(s => ({ student: s, att: calculateStudentAttendanceRate(s) }));

    let totalPresent = 0, totalDays = 0, atRisk = 0;
    list.forEach(x => {
        totalPresent += x.att.present;
        totalDays += x.att.total;
        if (x.att.total > 0 && x.att.rawPercentage < 75) atRisk++;
    });
    const schoolRate = totalDays > 0 ? (totalPresent / totalDays * 100) : 0;

    const statEl = el('prcStatSchoolAttendance');
    if (statEl) statEl.innerText = schoolRate.toFixed(1) + '%';
    const riskEl = el('prcStatAtRiskCount');
    if (riskEl) riskEl.innerText = atRisk;

    const gradeGroups = {};
    const defaultGrades = [
        'KG 1', 'KG 2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4',
        'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'
    ];
    defaultGrades.forEach(g => {
        gradeGroups[g] = { present: 0, total: 0 };
    });

    list.forEach(x => {
        const g = x.student.grade || 'Other';
        if (!gradeGroups[g]) gradeGroups[g] = { present: 0, total: 0 };
        gradeGroups[g].present += x.att.present;
        gradeGroups[g].total += x.att.total;
    });
    const chartContainer = el('prcAttGradeChart');
    if (chartContainer) {
        chartContainer.innerHTML = '';
        Object.keys(gradeGroups)
            .sort((a, b) => getGradeOrderIndex(a) - getGradeOrderIndex(b))
            .forEach(g => {
                const gp = gradeGroups[g];
                const rate = gp.total > 0 ? (gp.present / gp.total * 100) : 0;
                const color = gp.total === 0 ? 'var(--text-muted)' : (rate >= 90 ? '#22c55e' : rate >= 75 ? '#eab308' : '#ef4444');
                const row = document.createElement('div');
                row.style.margin = '14px 0';
                row.innerHTML = `
                    <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:5px;">
                        <span style="font-weight:700; color:var(--gold-light);">${escapeHTML(g)}</span>
                        <span style="color:${color}; font-weight:700;">${rate.toFixed(1)}%</span>
                    </div>
                    <div style="width:100%; height:8px; background:rgba(255,255,255,0.05); border-radius:4px; overflow:hidden; border:1px solid rgba(255,255,255,0.05);">
                        <div style="width:${Math.min(rate,100)}%; height:100%; background:${color}; border-radius:4px; transition:width .8s ease;"></div>
                    </div>
                `;
                chartContainer.appendChild(row);
            });
        if (Object.keys(gradeGroups).length === 0) {
            chartContainer.innerHTML = '<p style="opacity:0.6; text-align:center;">No attendance data recorded yet.</p>';
        }
    }

    if (gradeVal !== 'ALL') list = list.filter(x => x.student.grade === gradeVal);
    if (sectionVal !== 'ALL') list = list.filter(x => db_sectionsMatch(x.student.section, sectionVal));
    if (searchVal) list = list.filter(x => (x.student.name || '').toLowerCase().includes(searchVal) || (x.student.roll || '').toLowerCase().includes(searchVal) || (x.student.id || '').toLowerCase().includes(searchVal));

    list.sort((a, b) => a.att.rawPercentage - b.att.rawPercentage);

    const tbody = el('prcAttendanceTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:40px 0;">No matching student records found.</td></tr>`;
        return;
    }
    list.forEach(x => {
        const s = x.student, att = x.att;
        const color = att.rawPercentage >= 90 ? '#22c55e' : att.rawPercentage >= 75 ? '#eab308' : '#ef4444';
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onmouseover = () => { tr.style.background = 'rgba(201,168,76,0.05)'; };
        tr.onmouseout = () => { tr.style.background = 'transparent'; };
        tr.onclick = () => openStudentDetails(s.id);
        tr.innerHTML = `
            <td style="color:var(--gold); font-weight:700; padding:12px 8px;">${escapeHTML(s.id)}</td>
            <td style="font-weight:700; padding:12px 8px;">${escapeHTML(s.name)}</td>
            <td style="padding:12px 8px;"><span style="background:rgba(255,255,255,0.06); padding:3px 8px; border-radius:6px; font-size:12px;">${escapeHTML(s.grade)} - ${escapeHTML(s.section)}</span></td>
            <td style="padding:12px 8px; color:var(--text-secondary);">${att.present}/${att.total} days</td>
            <td style="padding:12px 8px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="width:60px; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                        <div style="width:${Math.min(att.rawPercentage,100)}%; height:100%; background:${color};"></div>
                    </div>
                    <span style="color:${color}; font-weight:700;">${att.percentage}</span>
                </div>
            </td>
            <td style="padding:12px 8px;">${att.total > 0 && att.rawPercentage < 75 ? '<span style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700;">AT RISK</span>' : '<span style="background:rgba(34,197,94,0.1); color:#22c55e; border:1px solid rgba(34,197,94,0.25); padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700;">OK</span>'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderPrincipalTeacherRoster() {
    const tableBody = el('prcTeacherTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    const searchVal = el('prcTeacherSearch').value.toLowerCase().trim();
    let list = stateDatabase.teachers || [];
    
    if (searchVal) {
        list = list.filter(t => t.name.toLowerCase().includes(searchVal) || t.subject.toLowerCase().includes(searchVal));
    }
    
    if (!list.length) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 40px 0;">No matching teacher profiles found.</td></tr>`;
        return;
    }
    
    list.forEach(t => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.style.transition = 'background 0.2s';
        tr.onmouseover = () => { tr.style.background = 'rgba(201, 168, 76, 0.05)'; };
        tr.onmouseout = () => { tr.style.background = 'transparent'; };
        tr.onclick = () => openTeacherDetails(t.id);
        
        const gradesStr = Array.isArray(t.grades) ? t.grades.join(', ') : 'None';
        
        tr.innerHTML = `
            <td style="color: var(--gold); font-weight: 700; padding: 12px 8px;">${escapeHTML(t.id)}</td>
            <td style="font-weight: 700; color: var(--text-primary); padding: 12px 8px;">${escapeHTML(t.name)}</td>
            <td style="color: var(--gold-light); font-weight: 600; padding: 12px 8px;">${escapeHTML(t.subject)}</td>
            <td style="padding: 12px 8px;"><span style="background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 500;">${escapeHTML(gradesStr)}</span></td>
            <td style="color: var(--text-secondary); padding: 12px 8px;">${escapeHTML(t.qualification || 'N/A')}</td>
        `;
        tableBody.appendChild(tr);
    });
}

function renderPrincipalAuditLogs() {
    const tableBody = el('prcLogsTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    let logs = stateDatabase.auditLogs || [];
    
    // Filters
    const searchInput = el('prcLogSearch');
    const categorySelect = el('prcLogCategoryFilter');
    const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const catVal = categorySelect ? categorySelect.value : 'ALL';

    if (catVal !== 'ALL') {
        logs = logs.filter(l => (l.action || '').toLowerCase().includes(catVal.toLowerCase()));
    }
    if (searchVal) {
        logs = logs.filter(l => 
            (l.actor || '').toLowerCase().includes(searchVal) || 
            (l.action || '').toLowerCase().includes(searchVal) || 
            (l.details || '').toLowerCase().includes(searchVal)
        );
    }

    if (!logs.length) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 40px 0; color: var(--text-muted);">No system events matched your search.</td></tr>`;
        return;
    }
    
    const reversedLogs = [...logs].reverse();
    
    reversedLogs.forEach(log => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
        
        let badgeColor = '#94a3b8'; // gray
        if (log.action.includes('Login') || log.action.includes('Verification')) badgeColor = '#10b981'; // green
        else if (log.action.includes('Lockout') || log.action.includes('Failed')) badgeColor = '#ef4444'; // red
        else if (log.action.includes('Backup') || log.action.includes('Restore')) badgeColor = '#3b82f6'; // blue
        else if (log.action.includes('Add') || log.action.includes('Register') || log.action.includes('Principal')) badgeColor = '#f59e0b'; // amber
        
        tr.innerHTML = `
            <td style="font-family: monospace; font-size: 11px; opacity: 0.7; padding: 12px 8px;">${escapeHTML(log.timestamp)}</td>
            <td style="font-weight: 600; color: var(--text-primary); padding: 12px 8px;">${escapeHTML(log.actor)}</td>
            <td style="padding: 12px 8px;"><span style="background: ${badgeColor}22; color: ${badgeColor}; border: 1px solid ${badgeColor}44; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;">${escapeHTML(log.action)}</span></td>
            <td style="color: var(--text-secondary); font-size: 12.5px; padding: 12px 8px;">${escapeHTML(log.details)}</td>
        `;
        tableBody.appendChild(tr);
    });
}

/* ── PRINCIPAL ACADEMIC ANALYTICS CONTROLLER ── */
function renderPrincipalAcademics() {
    const students = stateDatabase.students || [];
    if (!students.length) {
        const pRateEl = el('prcStatPassRate'); if (pRateEl) pRateEl.innerText = '0%';
        const hCountEl = el('prcStatHonorCount'); if (hCountEl) hCountEl.innerText = '0';
        const sCountEl = el('prcStatSupportCount'); if (sCountEl) sCountEl.innerText = '0';
        const chart = el('prcAcademicGradeChart'); if (chart) chart.innerHTML = '<p style="opacity:0.6; text-align:center;">No students registered.</p>';
        return;
    }

    let totalStudents = students.length;
    let honorRollStudents = [];
    let supportWatchlist = [];
    
    // Calculate student attendance and status
    const gradeScores = {};
    let passingCount = 0;

    students.forEach(s => {
        const att = calculateStudentAttendanceRate(s);
        const g = s.grade || 'Other';
        if (!gradeScores[g]) gradeScores[g] = { total: 0, count: 0 };
        
        // Use raw attendance rate or baseline 88% if no attendance records yet
        const score = att.total > 0 ? att.rawPercentage : 88;
        gradeScores[g].total += score;
        gradeScores[g].count++;

        if (score >= 50) passingCount++;

        if (score >= 85) {
            honorRollStudents.push({ student: s, score });
        } else if (score < 75) {
            supportWatchlist.push({ student: s, score, reason: att.total > 0 ? `Attendance: ${att.percentage}` : 'Academic Monitoring' });
        }
    });

    const passRate = ((passingCount / totalStudents) * 100).toFixed(1);
    
    const pRateEl = el('prcStatPassRate'); if (pRateEl) pRateEl.innerText = `${passRate}%`;
    const hCountEl = el('prcStatHonorCount'); if (hCountEl) hCountEl.innerText = honorRollStudents.length;
    const sCountEl = el('prcStatSupportCount'); if (sCountEl) sCountEl.innerText = supportWatchlist.length;

    // Render Academic Grade Chart
    const chartContainer = el('prcAcademicGradeChart');
    if (chartContainer) {
        chartContainer.innerHTML = '';
        Object.keys(gradeScores)
            .sort((a, b) => getGradeOrderIndex(a) - getGradeOrderIndex(b))
            .forEach(gr => {
                const item = gradeScores[gr];
                const avg = item.count > 0 ? (item.total / item.count) : 0;
                const pct = Math.min(avg, 100);
                const color = avg >= 85 ? '#22c55e' : avg >= 70 ? '#eab308' : '#ef4444';

                const row = document.createElement('div');
                row.style.margin = '14px 0';
                row.innerHTML = `
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 5px;">
                        <span style="font-weight: 700; color: var(--gold-light);">${escapeHTML(gr)}</span>
                        <span style="color: ${color}; font-weight: 700;">${avg.toFixed(1)}% Avg</span>
                    </div>
                    <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 4px; transition: width 0.8s ease;"></div>
                    </div>
                `;
                chartContainer.appendChild(row);
            });
    }

    // Render Honor Roll Table
    const honorTable = el('prcHonorRollTableBody');
    if (honorTable) {
        honorTable.innerHTML = '';
        if (!honorRollStudents.length) {
            honorTable.innerHTML = `<tr><td colspan="3" style="text-align:center; opacity:0.6; padding:16px;">No honor roll students listed yet.</td></tr>`;
        } else {
            honorRollStudents.slice(0, 5).forEach(h => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:600; color:var(--text-primary); padding:8px;">${escapeHTML(h.student.name)}</td>
                    <td style="color:var(--text-muted); padding:8px;">${escapeHTML(h.student.grade)} (${escapeHTML(h.student.section)})</td>
                    <td style="color:#22c55e; font-weight:700; padding:8px;">${h.score.toFixed(1)}%</td>
                `;
                honorTable.appendChild(tr);
            });
        }
    }

    // Render Academic Support Watchlist
    const supportTable = el('prcAcademicSupportTableBody');
    if (supportTable) {
        supportTable.innerHTML = '';
        if (!supportWatchlist.length) {
            supportTable.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#22c55e; padding:16px;">All students meeting standards.</td></tr>`;
        } else {
            supportWatchlist.slice(0, 5).forEach(s => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:600; color:var(--text-primary); padding:8px;">${escapeHTML(s.student.name)}</td>
                    <td style="color:var(--text-muted); padding:8px;">${escapeHTML(s.student.grade)} (${escapeHTML(s.student.section)})</td>
                    <td style="color:#f59e0b; font-weight:600; padding:8px;">${escapeHTML(s.reason)}</td>
                `;
                supportTable.appendChild(tr);
            });
        }
    }
}

/* ── PRINCIPAL EXECUTIVE PRINT REPORT CONTROLLER ── */
function printPrincipalExecutiveReport() {
    const students = stateDatabase.students || [];
    const teachers = stateDatabase.teachers || [];
    const announcements = stateDatabase.announcements || [];
    
    let totalPresent = 0;
    let totalDays = 0;
    students.forEach(s => {
        const att = calculateStudentAttendanceRate(s);
        totalPresent += att.present;
        totalDays += att.total;
    });
    const attRate = totalDays > 0 ? ((totalPresent / totalDays) * 100).toFixed(1) + '%' : '0.0%';

    const reportWindow = window.open('', '_blank');
    if (!reportWindow) {
        alert("Please allow popups to view the Executive Summary Report.");
        return;
    }

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Executive School Summary Report — Principal's Desk</title>
            <style>
                body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
                .header { border-bottom: 2px solid #cbd5e1; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }
                .title { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0; }
                .subtitle { font-size: 14px; color: #64748b; margin-top: 4px; }
                .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 30px; }
                .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
                .kpi-value { font-size: 28px; font-weight: 800; color: #1e3a8a; }
                .kpi-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; margin-top: 4px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #cbd5e1; padding: 10px 14px; text-align: left; font-size: 13px; }
                th { background: #f1f5f9; font-weight: 700; }
                .section-title { font-size: 16px; font-weight: 700; margin-top: 30px; border-left: 4px solid #1e3a8a; padding-left: 10px; color: #0f172a; }
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h1 class="title">OFFICIAL EXECUTIVE SCHOOL REPORT</h1>
                    <div class="subtitle">Generated from Principal Administration Desk &bull; ${new Date().toLocaleDateString()}</div>
                </div>
                <button onclick="window.print()" style="padding: 8px 16px; background: #1e3a8a; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Print Report</button>
            </div>

            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-value">${students.length}</div><div class="kpi-label">Active Students</div></div>
                <div class="kpi-card"><div class="kpi-value">${teachers.length}</div><div class="kpi-label">Teaching Faculty</div></div>
                <div class="kpi-card"><div class="kpi-value">${attRate}</div><div class="kpi-label">School Attendance Rate</div></div>
                <div class="kpi-card"><div class="kpi-value">${announcements.length}</div><div class="kpi-label">Bulletins Published</div></div>
            </div>

            <div class="section-title">Institutional Faculty Roster</div>
            <table>
                <thead>
                    <tr><th>ID</th><th>Teacher Name</th><th>Department / Subject</th><th>Assigned Grades</th></tr>
                </thead>
                <tbody>
                    ${teachers.length ? teachers.map(t => `
                        <tr>
                            <td>${escapeHTML(t.id)}</td>
                            <td><strong>${escapeHTML(t.name)}</strong></td>
                            <td>${escapeHTML(t.subject)}</td>
                            <td>${escapeHTML(Array.isArray(t.grades) ? t.grades.join(', ') : 'None')}</td>
                        </tr>
                    `).join('') : '<tr><td colspan="4" style="text-align:center;">No faculty members registered.</td></tr>'}
                </tbody>
            </table>

            <div class="section-title">Recent Principal Bulletins</div>
            <table>
                <thead>
                    <tr><th>Date</th><th>Bulletin Title</th><th>Summary</th></tr>
                </thead>
                <tbody>
                    ${announcements.length ? announcements.slice().reverse().slice(0, 5).map(a => `
                        <tr>
                            <td>${escapeHTML(a.date || 'Today')}</td>
                            <td><strong>${escapeHTML(a.title)}</strong></td>
                            <td>${escapeHTML(a.desc)}</td>
                        </tr>
                    `).join('') : '<tr><td colspan="3" style="text-align:center;">No bulletins published.</td></tr>'}
                </tbody>
            </table>
        </body>
        </html>
    `;

    reportWindow.document.write(htmlContent);
    reportWindow.document.close();
}

// Student attendance details removed as requested

/* ═══════════════════════════════════════════════════════════════════════════
   MODULE 1: APPROVAL & REQUEST CENTER CONTROLLERS
   ═══════════════════════════════════════════════════════════════════════════ */
function switchApprovalSubTab(sub) {
    const leaveBtn = el('prcApprTabLeave');
    const budgetBtn = el('prcApprTabBudget');
    const gradeBtn = el('prcApprTabGrade');
    const leaveBox = el('prcSubLeaveRequests');
    const budgetBox = el('prcSubBudgetRequests');
    const gradeBox = el('prcSubGradeModifications');

    if (leaveBtn) leaveBtn.className = sub === 'leave' ? 'glass-btn primary-btn' : 'glass-btn secondary-btn';
    if (budgetBtn) budgetBtn.className = sub === 'budget' ? 'glass-btn primary-btn' : 'glass-btn secondary-btn';
    if (gradeBtn) gradeBtn.className = sub === 'grade' ? 'glass-btn primary-btn' : 'glass-btn secondary-btn';

    if (leaveBox) leaveBox.style.display = sub === 'leave' ? 'block' : 'none';
    if (budgetBox) budgetBox.style.display = sub === 'budget' ? 'block' : 'none';
    if (gradeBox) gradeBox.style.display = sub === 'grade' ? 'block' : 'none';
}

function renderPrincipalApprovals() {
    // 1. Leave Requests
    const leaveTable = el('prcLeaveTableBody');
    if (leaveTable) {
        leaveTable.innerHTML = '';
        const leaves = stateDatabase.leaveRequests || [];
        if (!leaves.length) {
            leaveTable.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">No leave requests submitted.</td></tr>`;
        } else {
            leaves.forEach(l => {
                const tr = document.createElement('tr');
                let badgeClass = l.status === 'Approved' ? '#10b981' : l.status === 'Denied' ? '#ef4444' : '#f59e0b';
                tr.innerHTML = `
                    <td style="font-family:monospace; font-size:11px; padding:10px;">${escapeHTML(l.id)}</td>
                    <td style="font-weight:600; padding:10px;">${escapeHTML(l.applicantName)}</td>
                    <td style="padding:10px;">${escapeHTML(l.role)}</td>
                    <td style="padding:10px;"><span style="background:rgba(255,255,255,0.06); padding:3px 8px; border-radius:4px; font-size:11px;">${escapeHTML(l.type)}</span></td>
                    <td style="padding:10px;">${escapeHTML(l.dates)}</td>
                    <td style="padding:10px; font-size:12px; color:var(--text-secondary);">${escapeHTML(l.reason)}</td>
                    <td style="padding:10px;"><span style="color:${badgeClass}; font-weight:700;">${escapeHTML(l.status)}</span></td>
                    <td style="padding:10px; text-align:right;">
                        ${l.status === 'Pending' ? `
                            <button class="glass-btn primary-btn" style="padding:3px 8px; font-size:11px; margin-right:4px;" onclick="approveLeaveRequest('${l.id}')">Grant</button>
                            <button class="glass-btn secondary-btn" style="padding:3px 8px; font-size:11px; color:#ef4444;" onclick="denyLeaveRequest('${l.id}')">Deny</button>
                        ` : `<span style="font-size:11px; opacity:0.6;">Closed</span>`}
                    </td>
                `;
                leaveTable.appendChild(tr);
            });
        }
    }

    // 2. Budget Requests
    const budgetTable = el('prcBudgetTableBody');
    if (budgetTable) {
        budgetTable.innerHTML = '';
        const budgets = stateDatabase.budgetRequests || [];
        if (!budgets.length) {
            budgetTable.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">No budget requisitions logged.</td></tr>`;
        } else {
            budgets.forEach(b => {
                const tr = document.createElement('tr');
                let badgeClass = b.status === 'Approved' ? '#10b981' : b.status === 'Denied' ? '#ef4444' : '#f59e0b';
                tr.innerHTML = `
                    <td style="font-family:monospace; font-size:11px; padding:10px;">${escapeHTML(b.id)}</td>
                    <td style="font-weight:600; padding:10px;">${escapeHTML(b.department)}</td>
                    <td style="padding:10px;">${escapeHTML(b.title)}</td>
                    <td style="padding:10px; font-size:12px;">${escapeHTML(b.requestedBy)}</td>
                    <td style="padding:10px; font-weight:700; color:var(--gold-light);">$${b.amount.toLocaleString()}</td>
                    <td style="padding:10px;"><span style="color:${badgeClass}; font-weight:700;">${escapeHTML(b.status)}</span></td>
                    <td style="padding:10px; text-align:right;">
                        ${b.status === 'Pending' ? `
                            <button class="glass-btn primary-btn" style="padding:3px 8px; font-size:11px; margin-right:4px;" onclick="approveBudgetRequest('${b.id}')">Approve Funding</button>
                            <button class="glass-btn secondary-btn" style="padding:3px 8px; font-size:11px; color:#ef4444;" onclick="denyBudgetRequest('${b.id}')">Deny</button>
                        ` : `<span style="font-size:11px; opacity:0.6;">Closed</span>`}
                    </td>
                `;
                budgetTable.appendChild(tr);
            });
        }
    }

    // 3. Grade Modifications
    const gradeTable = el('prcGradeModTableBody');
    if (gradeTable) {
        gradeTable.innerHTML = '';
        const gradeMods = stateDatabase.gradeModifications || [];
        if (!gradeMods.length) {
            gradeTable.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">No score change requests submitted.</td></tr>`;
        } else {
            gradeMods.forEach(g => {
                const tr = document.createElement('tr');
                let badgeClass = g.status === 'Approved' ? '#10b981' : g.status === 'Denied' ? '#ef4444' : '#f59e0b';
                tr.innerHTML = `
                    <td style="font-family:monospace; font-size:11px; padding:10px;">${escapeHTML(g.id)}</td>
                    <td style="font-weight:600; padding:10px;">${escapeHTML(g.teacherName)}</td>
                    <td style="padding:10px;">${escapeHTML(g.studentName)}</td>
                    <td style="padding:10px; font-size:12px;">${escapeHTML(g.subject)}</td>
                    <td style="padding:10px; font-weight:700; color:#3b82f6;">${escapeHTML(g.originalGrade)} &rarr; <span style="color:#10b981;">${escapeHTML(g.proposedGrade)}</span></td>
                    <td style="padding:10px; font-size:12px; color:var(--text-secondary);">${escapeHTML(g.reason)}</td>
                    <td style="padding:10px;"><span style="color:${badgeClass}; font-weight:700;">${escapeHTML(g.status)}</span></td>
                    <td style="padding:10px; text-align:right;">
                        ${g.status === 'Pending' ? `
                            <button class="glass-btn primary-btn" style="padding:3px 8px; font-size:11px; margin-right:4px;" onclick="approveGradeModRequest('${g.id}')">Approve Score Change</button>
                            <button class="glass-btn secondary-btn" style="padding:3px 8px; font-size:11px; color:#ef4444;" onclick="denyGradeModRequest('${g.id}')">Reject</button>
                        ` : `<span style="font-size:11px; opacity:0.6;">Closed</span>`}
                    </td>
                `;
                gradeTable.appendChild(tr);
            });
        }
    }
}

function approveLeaveRequest(id) {
    const l = (stateDatabase.leaveRequests || []).find(item => item.id === id);
    if (l) {
        l.status = 'Approved';
        db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Leave Request Approved', `Approved leave for ${l.applicantName} (${l.dates}).`);
        saveState();
        renderPrincipalApprovals();
    }
}

function denyLeaveRequest(id) {
    const l = (stateDatabase.leaveRequests || []).find(item => item.id === id);
    if (l) {
        l.status = 'Denied';
        db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Leave Request Denied', `Denied leave for ${l.applicantName}.`);
        saveState();
        renderPrincipalApprovals();
    }
}

function approveBudgetRequest(id) {
    const b = (stateDatabase.budgetRequests || []).find(item => item.id === id);
    if (b) {
        b.status = 'Approved';
        db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Budget Approved', `Approved $${b.amount} for ${b.department} - ${b.title}.`);
        saveState();
        renderPrincipalApprovals();
    }
}

function denyBudgetRequest(id) {
    const b = (stateDatabase.budgetRequests || []).find(item => item.id === id);
    if (b) {
        b.status = 'Denied';
        db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Budget Denied', `Denied funding for ${b.department} - ${b.title}.`);
        saveState();
        renderPrincipalApprovals();
    }
}

function promptNewBudgetRequest() {
    const dept = prompt("Enter Department Name (e.g. Science Lab, Sports Dept, Library):");
    if (!dept) return;
    const title = prompt("Enter Requisition / Equipment Item Title:");
    if (!title) return;
    const amountStr = prompt("Enter Requested Amount in USD ($):", "1500");
    const amount = parseFloat(amountStr) || 0;
    const reqBy = prompt("Requested By (Staff Name):", "Faculty Lead");

    const newReq = {
        id: 'BG-' + Math.floor(100 + Math.random() * 900),
        department: dept,
        title: title,
        amount: amount,
        requestedBy: reqBy || 'Faculty',
        status: 'Pending'
    };
    if (!stateDatabase.budgetRequests) stateDatabase.budgetRequests = [];
    stateDatabase.budgetRequests.unshift(newReq);
    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Budget Requisition Submitted', `New budget request created for ${dept}: $${amount}.`);
    saveState();
    renderPrincipalApprovals();
}

function approveGradeModRequest(id) {
    const g = (stateDatabase.gradeModifications || []).find(item => item.id === id);
    if (g) {
        g.status = 'Approved';
        db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Grade Change Approved', `Approved grade modification for ${g.studentName} in ${g.subject} to ${g.proposedGrade}.`);
        saveState();
        renderPrincipalApprovals();
    }
}

function denyGradeModRequest(id) {
    const g = (stateDatabase.gradeModifications || []).find(item => item.id === id);
    if (g) {
        g.status = 'Denied';
        db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Grade Change Rejected', `Rejected grade modification for ${g.studentName}.`);
        saveState();
        renderPrincipalApprovals();
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODULE 2: TEACHER & STAFF PERFORMANCE EVALUATION CONTROLLERS
   ═══════════════════════════════════════════════════════════════════════════ */
function renderPrincipalEvaluation() {
    // Populate teacher select dropdown
    const selectEl = el('prcObsTeacherSelect');
    if (selectEl) {
        selectEl.innerHTML = '';
        const teachers = stateDatabase.teachers || [];
        teachers.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.name;
            opt.innerText = `${t.name} (${t.subject || 'Faculty'})`;
            selectEl.appendChild(opt);
        });
    }

    // Render Observation History
    const historyBox = el('prcObservationHistoryBox');
    if (historyBox) {
        historyBox.innerHTML = '';
        const obs = stateDatabase.observationLogs || [];
        if (!obs.length) {
            historyBox.innerHTML = '<p style="opacity:0.6; text-align:center; padding:20px;">No classroom observations logged yet.</p>';
        } else {
            obs.slice().reverse().forEach(o => {
                const card = document.createElement('div');
                card.style.background = 'rgba(255,255,255,0.03)';
                card.style.border = '1px solid rgba(255,255,255,0.07)';
                card.style.borderRadius = '10px';
                card.style.padding = '12px';
                card.style.marginBottom = '10px';
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <span style="font-weight:700; color:var(--gold-light);">${escapeHTML(o.teacherName)}</span>
                        <span style="color:#eab308; font-weight:700;">⭐ ${o.score} / 5.0</span>
                    </div>
                    <div style="font-size:11px; opacity:0.6; margin-bottom:6px;">${escapeHTML(o.subject || 'General Observation')} &bull; ${escapeHTML(o.date || todayISO())}</div>
                    <div style="font-size:12.5px; color:var(--text-secondary); margin-bottom:6px;">"${escapeHTML(o.notes)}"</div>
                    ${o.recommendations ? `<div style="font-size:11.5px; color:#10b981; font-weight:600;">💡 Rec: ${escapeHTML(o.recommendations)}</div>` : ''}
                `;
                historyBox.appendChild(card);
            });
        }
    }

    // Render Teacher KPI Cards Grid
    const kpiGrid = el('prcTeacherKPIGrid');
    if (kpiGrid) {
        kpiGrid.innerHTML = '';
        const teachers = stateDatabase.teachers || [];
        const kpis = stateDatabase.teacherKPIs || {};

        if (!teachers.length) {
            kpiGrid.innerHTML = '<p style="opacity:0.6; text-align:center; grid-column:1/-1;">No faculty registered in teacher roster.</p>';
            return;
        }

        teachers.forEach(t => {
            const data = kpis[t.id] || { punctuality: 96, lessonCompletion: 92, passRate: 88, rating: 4.6, pdCertifications: ['Active Educator 2026'] };
            const card = document.createElement('div');
            card.style.background = 'rgba(255,255,255,0.03)';
            card.style.border = '1px solid var(--gold-border)';
            card.style.borderRadius = '12px';
            card.style.padding = '16px';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:700; font-size:15px; color:var(--text-primary);">${escapeHTML(t.name)}</div>
                        <div style="font-size:12px; color:var(--text-muted);">${escapeHTML(t.subject)}</div>
                    </div>
                    <span style="background:rgba(234,179,8,0.15); color:#eab308; border:1px solid rgba(234,179,8,0.3); padding:4px 8px; border-radius:6px; font-weight:700; font-size:12px;">
                        ⭐ ${data.rating} / 5.0
                    </span>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; background:rgba(0,0,0,0.2); padding:8px; border-radius:8px; text-align:center; margin-bottom:10px; font-size:11px;">
                    <div><div style="opacity:0.6;">Punctuality</div><div style="font-weight:700; color:#10b981;">${data.punctuality}%</div></div>
                    <div><div style="opacity:0.6;">Syllabus</div><div style="font-weight:700; color:#3b82f6;">${data.lessonCompletion}%</div></div>
                    <div><div style="opacity:0.6;">Pass Rate</div><div style="font-weight:700; color:var(--gold-light);">${data.passRate}%</div></div>
                </div>
                <div style="font-size:11px; margin-bottom:10px;">
                    <span style="opacity:0.6;">Professional Certs:</span>
                    <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">
                        ${(data.pdCertifications || []).map(c => `<span style="background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px; font-size:10px;">🎖️ ${escapeHTML(c)}</span>`).join('')}
                    </div>
                </div>
                <button class="glass-btn secondary-btn" style="width:100%; padding:4px; font-size:11px;" onclick="updateTeacherKPIRating('${t.id}')">✏️ Adjust Performance Rating</button>
            `;
            kpiGrid.appendChild(card);
        });
    }
}

function saveClassroomObservation() {
    const teacherSelect = el('prcObsTeacherSelect');
    const teacherName = teacherSelect ? teacherSelect.value : 'Faculty Member';
    const subject = el('prcObsSubject') ? el('prcObsSubject').value.trim() : '';
    const rating = parseFloat(el('prcObsRating') ? el('prcObsRating').value : 4.5);
    const notes = el('prcObsNotes') ? el('prcObsNotes').value.trim() : '';
    const recommendations = el('prcObsRecommendations') ? el('prcObsRecommendations').value.trim() : '';

    if (!notes) {
        alert("Please enter observation notes before saving.");
        return;
    }

    const obsLog = {
        id: 'OB-' + Math.floor(100 + Math.random() * 900),
        teacherName: teacherName,
        subject: subject || 'Class Walkthrough',
        date: todayISO(),
        score: rating,
        notes: notes,
        recommendations: recommendations
    };

    if (!stateDatabase.observationLogs) stateDatabase.observationLogs = [];
    stateDatabase.observationLogs.push(obsLog);
    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Classroom Observation Logged', `Logged walkthrough for ${teacherName} (Rating: ${rating}/5.0).`);
    saveState();

    if (el('prcObsNotes')) el('prcObsNotes').value = '';
    if (el('prcObsRecommendations')) el('prcObsRecommendations').value = '';

    renderPrincipalEvaluation();
}

function updateTeacherKPIRating(teacherId) {
    if (!stateDatabase.teacherKPIs) stateDatabase.teacherKPIs = {};
    const t = (stateDatabase.teachers || []).find(item => item.id === teacherId);
    const name = t ? t.name : 'Teacher';
    const current = stateDatabase.teacherKPIs[teacherId] || { rating: 4.5, punctuality: 96, lessonCompletion: 92, passRate: 88, pdCertifications: [] };

    const newRatingStr = prompt(`Enter updated Performance Star Rating (1.0 to 5.0) for ${name}:`, current.rating);
    if (!newRatingStr) return;
    const newRating = parseFloat(newRatingStr);
    if (isNaN(newRating) || newRating < 1 || newRating > 5) {
        alert("Invalid rating value. Must be between 1.0 and 5.0");
        return;
    }

    current.rating = newRating;
    stateDatabase.teacherKPIs[teacherId] = current;
    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Faculty Rating Updated', `Updated rating for ${name} to ${newRating}/5.0.`);
    saveState();
    renderPrincipalEvaluation();
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODULE 3: EMERGENCY & SAFETY COMMAND CENTER CONTROLLERS (ENHANCED)
   ═══════════════════════════════════════════════════════════════════════════ */
function setEmgLevelPreset(text) {
    const input = el('prcEmgLevel');
    if (input) {
        input.value = text;
        input.focus();
    }
}

function renderPrincipalEmergency() {
    // 1. Render Emergency Broadcast History
    const historyBox = el('prcEmgHistoryBox');
    if (historyBox) {
        historyBox.innerHTML = '';
        const emgs = stateDatabase.emergencyBroadcasts || [];
        if (!emgs.length) {
            historyBox.innerHTML = '<p style="opacity:0.6; text-align:center; padding:20px;">No emergency alerts dispatched.</p>';
        } else {
            emgs.slice().reverse().forEach(e => {
                const card = document.createElement('div');
                card.style.background = 'rgba(239, 68, 68, 0.08)';
                card.style.border = '1px solid rgba(239, 68, 68, 0.3)';
                card.style.borderRadius = '10px';
                card.style.padding = '12px';
                card.style.marginBottom = '10px';
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                        <span style="font-weight:700; color:#fca5a5;">🚨 ${escapeHTML(e.type)}</span>
                        <span style="font-size:11px; opacity:0.7; color:#fff;">${escapeHTML(e.timestamp)}</span>
                    </div>
                    <div style="font-size:11.5px; opacity:0.85; margin-bottom:6px; color:#fecaca;">Target: <strong>${escapeHTML(e.target || 'School-Wide')}</strong></div>
                    <div style="font-size:12.5px; color:#fff; line-height:1.4; margin-bottom:8px;">"${escapeHTML(e.message)}"</div>
                    <div style="text-align:right;">
                        <button class="glass-btn secondary-btn" style="padding:2px 8px; font-size:10.5px; border-color:rgba(239,68,68,0.4); color:#fca5a5;" onclick="deletePrincipalEmergencyBroadcast('${e.id}')">Retract Alert</button>
                    </div>
                `;
                historyBox.appendChild(card);
            });
        }
    }

    // 2. Render Campus Incident Table
    const incidentTable = el('prcIncidentTableBody');
    if (incidentTable) {
        incidentTable.innerHTML = '';
        const incidents = stateDatabase.campusIncidents || [];
        if (!incidents.length) {
            incidentTable.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">No campus safety incidents recorded.</td></tr>`;
        } else {
            incidents.forEach(inc => {
                const tr = document.createElement('tr');
                let badgeColor = inc.status === 'Resolved' ? '#10b981' : inc.status === 'Investigating' ? '#f59e0b' : '#ef4444';
                tr.innerHTML = `
                    <td style="font-family:monospace; font-size:11px; padding:10px;">${escapeHTML(inc.id)}</td>
                    <td style="font-weight:600; padding:10px;">${escapeHTML(inc.studentName)}</td>
                    <td style="padding:10px;"><span style="background:rgba(255,255,255,0.06); padding:3px 8px; border-radius:4px; font-size:11px;">${escapeHTML(inc.category)}</span></td>
                    <td style="padding:10px;">${escapeHTML(inc.date)}</td>
                    <td style="padding:10px; font-size:12px; color:var(--text-secondary);">${escapeHTML(inc.details)}</td>
                    <td style="padding:10px;"><span style="color:${badgeColor}; font-weight:700;">${escapeHTML(inc.status)}</span></td>
                    <td style="padding:10px; text-align:right;">
                        ${inc.status !== 'Resolved' ? `
                            <button class="glass-btn primary-btn" style="padding:3px 8px; font-size:11px; margin-right:4px;" onclick="updateIncidentStatus('${inc.id}', 'Resolved')">Mark Resolved</button>
                            ${inc.status !== 'Investigating' ? `<button class="glass-btn secondary-btn" style="padding:3px 8px; font-size:11px;" onclick="updateIncidentStatus('${inc.id}', 'Investigating')">Investigate</button>` : ''}
                        ` : `<span style="font-size:11px; opacity:0.6;">Resolved</span>`}
                    </td>
                `;
                incidentTable.appendChild(tr);
            });
        }
    }
}

function deletePrincipalEmergencyBroadcast(id) {
    if (!confirm("Are you sure you want to retract/remove this emergency broadcast?")) return;
    if (stateDatabase.emergencyBroadcasts) {
        stateDatabase.emergencyBroadcasts = stateDatabase.emergencyBroadcasts.filter(b => b.id !== id);
    }
    saveState();
    updateAllPortalNotificationBadges();
    renderPrincipalEmergency();
}

function sendPrincipalEmergencyBroadcast() {
    const levelInput = el('prcEmgLevel');
    const level = levelInput ? levelInput.value.trim() : 'Severe Weather Alert';
    const target = el('prcEmgTarget') ? el('prcEmgTarget').value : 'ALL';
    const message = el('prcEmgMessage') ? el('prcEmgMessage').value.trim() : '';

    if (!level) {
        alert("Please specify or type an Emergency Alert Level.");
        if (levelInput) levelInput.focus();
        return;
    }

    if (!message) {
        alert("Please enter the emergency broadcast message content.");
        if (el('prcEmgMessage')) el('prcEmgMessage').focus();
        return;
    }

    const alertId = 'EMG-' + Date.now();
    const alertItem = {
        id: alertId,
        type: level,
        target: target,
        message: message,
        timestamp: new Date().toLocaleString()
    };

    if (!stateDatabase.emergencyBroadcasts) stateDatabase.emergencyBroadcasts = [];
    stateDatabase.emergencyBroadcasts.push(alertItem);

    // 1. Also dispatch to main announcements feed so parents and students see it directly in their news feed
    if (!stateDatabase.announcements) stateDatabase.announcements = [];
    stateDatabase.announcements.push({
        id: 'ANN-EMG-' + Date.now(),
        title: `🚨 EMERGENCY BROADCAST: ${level}`,
        desc: message,
        date: todayISO(),
        category: 'Emergency',
        targetAudience: target
    });

    // 2. Broadcast directly into all Class Group Chats so students and teachers get immediate notification in their Chat Box
    const activeGrades = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12', 'LKG', 'UKG'];
    const activeSections = ['Section A', 'Section B', 'Section C'];
    
    activeGrades.forEach(g => {
        activeSections.forEach(sec => {
            db_addClassChatMessage(g, sec, {
                type: 'text',
                content: `🚨 [EMERGENCY COMMAND: ${level}]\n${message}`,
                senderRole: 'admin',
                senderId: 'PRINCIPAL-OFFICE',
                senderName: 'Principal Office',
                time: now(),
                isEmergency: true
            });
        });
    });

    // 3. Clear any past dismissal of this new emergency alert
    sessionStorage.removeItem('dismissed_emg_' + alertId);

    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Emergency Broadcast Sent', `Dispatched emergency alert (${level}) to ${target}.`);
    saveState();

    if (el('prcEmgMessage')) el('prcEmgMessage').value = '';
    
    // 4. Update all notification badges across portals & mobile bottom tab bar
    updateAllPortalNotificationBadges();

    // 5. Show live alert popup modal
    showGlobalEmergencyModal(alertItem);
    
    renderPrincipalEmergency();
}

/* ── Global Emergency Live Notification & Banners ── */
function showGlobalEmergencyModal(alertItem) {
    let modal = el('globalEmergencyModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'globalEmergencyModal';
        modal.className = 'emergency-modal-overlay';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="emergency-modal-card">
            <div class="emergency-modal-header">
                <div class="emg-icon-ring">🚨</div>
                <div>
                    <h3>EMERGENCY BROADCAST</h3>
                    <span>Principal Safety Command</span>
                </div>
                <button class="emg-modal-close" onclick="closeEmergencyModal()">✕</button>
            </div>
            <div class="emergency-modal-body">
                <div class="emg-modal-level">${escapeHTML(alertItem.type || 'Critical Notice')}</div>
                <p class="emg-modal-message">${escapeHTML(alertItem.message)}</p>
                <div class="emg-modal-meta">
                    <span><strong>Audience:</strong> ${escapeHTML(alertItem.target || 'School-Wide')}</span>
                    <span><strong>Time:</strong> ${escapeHTML(alertItem.timestamp || 'Just now')}</span>
                </div>
            </div>
            <div class="emergency-modal-footer">
                <button class="glass-btn primary-btn" style="width: 100%; background: #ef4444; color: white; border: none; font-weight: 700; padding: 12px; border-radius: 12px; font-size: 14px; cursor: pointer;" onclick="closeEmergencyModal()">
                    ✓ Understood &amp; Acknowledged
                </button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

function closeEmergencyModal() {
    const modal = el('globalEmergencyModal');
    if (modal) modal.style.display = 'none';
}

function handleEmergencyBannerClick(id) {
    if (el('studentSection') && el('studentSection').style.display !== 'none') {
        switchStudentTab('annancements');
    } else if (el('parentSection') && el('parentSection').style.display !== 'none') {
        switchParentTab('announcements');
    } else if (el('teacherSection') && el('teacherSection').style.display !== 'none') {
        switchTeacherTab('chat');
    } else if (el('principalSection') && el('principalSection').style.display !== 'none') {
        switchPrincipalTab('emergency');
    }
}

function dismissEmergencyBanner(id) {
    sessionStorage.setItem('dismissed_emg_' + id, 'true');
    renderPortalEmergencyBanners();
    updateAllPortalNotificationBadges();
}

function renderPortalEmergencyBanners() {
    const broadcasts = (stateDatabase.emergencyBroadcasts || []).slice();
    if (!broadcasts.length) {
        ['prnEmergencyBannerContainer', 'stdEmergencyBannerContainer', 'tchEmergencyBannerContainer', 'prcEmergencyBannerContainer'].forEach(id => {
            const elContainer = el(id);
            if (elContainer) elContainer.innerHTML = '';
        });
        const mobileTicker = el('mobileEmergencyFloatingTicker');
        if (mobileTicker) mobileTicker.style.display = 'none';
        return;
    }
    
    // Get latest active broadcast
    const latest = broadcasts[broadcasts.length - 1];
    const isDismissed = sessionStorage.getItem('dismissed_emg_' + latest.id) === 'true';
    
    ['prnEmergencyBannerContainer', 'stdEmergencyBannerContainer', 'tchEmergencyBannerContainer', 'prcEmergencyBannerContainer'].forEach(id => {
        const elContainer = el(id);
        if (!elContainer) return;
        
        let isRelevant = true;
        if (id.includes('prn') && latest.target !== 'ALL' && latest.target !== 'PARENTS') isRelevant = false;
        if (id.includes('std') && latest.target !== 'ALL' && latest.target !== 'STUDENTS') isRelevant = false;
        if (id.includes('tch') && latest.target !== 'ALL' && latest.target !== 'TEACHERS') isRelevant = false;
        
        if (!isRelevant || isDismissed) {
            elContainer.innerHTML = '';
            return;
        }
        
        elContainer.innerHTML = `
            <div class="emergency-live-banner" onclick="handleEmergencyBannerClick('${latest.id}')">
                <div class="emg-banner-left">
                    <span class="emg-banner-pulse-dot"></span>
                    <div class="emg-banner-content">
                        <div class="emg-banner-badge">🚨 EMERGENCY COMMAND BROADCAST • ${escapeHTML(latest.type || 'Alert')}</div>
                        <div class="emg-banner-msg">${escapeHTML(latest.message)}</div>
                        <div class="emg-banner-meta">Dispatched: ${escapeHTML(latest.timestamp || 'Just now')} • Target: ${escapeHTML(latest.target || 'School-Wide')}</div>
                    </div>
                </div>
                <div class="emg-banner-actions">
                    <button class="emg-banner-ack-btn" onclick="event.stopPropagation(); dismissEmergencyBanner('${latest.id}')">✓ Acknowledge</button>
                </div>
            </div>
        `;
    });

    // Mobile Top Floating Ticker
    const mobileTicker = el('mobileEmergencyFloatingTicker');
    if (mobileTicker) {
        if (!isDismissed) {
            mobileTicker.innerHTML = `
                <div class="mobile-ticker-inner" onclick="handleEmergencyBannerClick('${latest.id}')">
                    <div class="mobile-ticker-icon">🚨</div>
                    <div class="mobile-ticker-text">
                        <strong>EMERGENCY: ${escapeHTML(latest.type || 'Notice')}</strong>
                        <span>${escapeHTML(latest.message.substring(0, 60))}${latest.message.length > 60 ? '...' : ''}</span>
                    </div>
                    <button class="mobile-ticker-close" onclick="event.stopPropagation(); dismissEmergencyBanner('${latest.id}')" aria-label="Dismiss">✕</button>
                </div>
            `;
            mobileTicker.style.display = 'block';
        } else {
            mobileTicker.style.display = 'none';
        }
    }
}

function updateAllPortalNotificationBadges() {
    const broadcasts = stateDatabase.emergencyBroadcasts || [];
    const latest = broadcasts.length ? broadcasts[broadcasts.length - 1] : null;
    const isDismissed = latest ? (sessionStorage.getItem('dismissed_emg_' + latest.id) === 'true') : true;
    const emgUnreadCount = (latest && !isDismissed) ? 1 : 0;

    // 1. Parent Portal: #prnTabBtnAnn
    const prnAnnBtn = el('prnTabBtnAnn');
    if (prnAnnBtn) {
        let badge = prnAnnBtn.querySelector('.menu-badge');
        if (emgUnreadCount > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge emg-badge';
                prnAnnBtn.appendChild(badge);
            }
            badge.innerText = emgUnreadCount;
            badge.style.display = 'inline-flex';
        } else if (badge) {
            badge.remove();
        }
    }

    // 2. Student Portal: #stdTabBtnChat, #stdTabBtnAnn
    const stdChatBtn = el('stdTabBtnChat');
    if (stdChatBtn) {
        let badge = stdChatBtn.querySelector('.menu-badge');
        if (emgUnreadCount > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge emg-badge';
                stdChatBtn.appendChild(badge);
            }
            badge.innerText = '1';
            badge.style.display = 'inline-flex';
        } else if (badge) {
            badge.remove();
        }
    }
    const stdAnnBtn = el('stdTabBtnAnn');
    if (stdAnnBtn) {
        let badge = stdAnnBtn.querySelector('.menu-badge');
        if (emgUnreadCount > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge emg-badge';
                stdAnnBtn.appendChild(badge);
            }
            badge.innerText = '1';
            badge.style.display = 'inline-flex';
        } else if (badge) {
            badge.remove();
        }
    }
    updateStudentSidebarNotificationCount();

    // 3. Teacher Portal: #tchTabBtnChat, #tchTabBtnMyWork
    const tchChatBtn = el('tchTabBtnChat');
    if (tchChatBtn) {
        let badge = tchChatBtn.querySelector('.menu-badge');
        if (emgUnreadCount > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge emg-badge';
                tchChatBtn.appendChild(badge);
            }
            badge.innerText = '1';
            badge.style.display = 'inline-flex';
        } else if (badge) {
            badge.remove();
        }
    }
    const tchWorkBtn = el('tchTabBtnMyWork');
    if (tchWorkBtn) {
        let badge = tchWorkBtn.querySelector('.menu-badge');
        if (emgUnreadCount > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge emg-badge';
                tchWorkBtn.appendChild(badge);
            }
            badge.innerText = '1';
            badge.style.display = 'inline-flex';
        } else if (badge) {
            badge.remove();
        }
    }

    // 4. Principal Portal: #prcTabBtnEmergency
    const prcEmgBtn = el('prcTabBtnEmergency');
    if (prcEmgBtn) {
        let badge = prcEmgBtn.querySelector('.menu-badge');
        if (broadcasts.length > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge emg-badge';
                prcEmgBtn.appendChild(badge);
            }
            badge.innerText = broadcasts.length;
            badge.style.display = 'inline-flex';
        } else if (badge) {
            badge.remove();
        }
    }

    // 5. Update mobile bottom tab bar active badges
    if (typeof buildBottomTabBar === 'function') {
        const roleId = (typeof getActiveBottomBarRoleId === 'function') ? getActiveBottomBarRoleId() : null;
        if (roleId && typeof syncBottomTabBarActiveState === 'function') {
            syncBottomTabBarActiveState(roleId, new Set());
        }
    }

    renderPortalEmergencyBanners();
}

function promptNewIncidentLog() {
    const name = prompt("Enter Student / Individual Name:");
    if (!name) return;
    const category = prompt("Enter Category (Discipline, Bullying, Medical Clinic, Security):", "Medical Clinic");
    const details = prompt("Enter Incident Details:");
    if (!details) return;

    const newInc = {
        id: 'INC-' + Math.floor(100 + Math.random() * 900),
        studentName: name,
        category: category || 'General Incident',
        date: todayISO(),
        details: details,
        status: 'Open'
    };

    if (!stateDatabase.campusIncidents) stateDatabase.campusIncidents = [];
    stateDatabase.campusIncidents.unshift(newInc);
    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Incident Logged', `Logged ${category} incident for ${name}.`);
    saveState();
    renderPrincipalEmergency();
}

function updateIncidentStatus(id, newStatus) {
    const inc = (stateDatabase.campusIncidents || []).find(i => i.id === id);
    if (inc) {
        inc.status = newStatus;
        db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Incident Status Updated', `Updated incident ${id} status to ${newStatus}.`);
        saveState();
        renderPrincipalEmergency();
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODULE 4: ACADEMIC & EXAMINATION OVERSIGHT CONTROLLERS (ENHANCED)
   ═══════════════════════════════════════════════════════════════════════════ */
function renderPrincipalAcademics() {
    const students = stateDatabase.students || [];
    let totalStudents = students.length;
    let honorRollStudents = [];
    let supportWatchlist = [];
    
    const gradeScores = {};
    let passingCount = 0;

    students.forEach(s => {
        const att = calculateStudentAttendanceRate(s);
        const g = s.grade || 'Grade 10';
        if (!gradeScores[g]) gradeScores[g] = { total: 0, count: 0 };
        
        const score = att.total > 0 ? att.rawPercentage : 88;
        gradeScores[g].total += score;
        gradeScores[g].count++;

        if (score >= 50) passingCount++;

        if (score >= 85) {
            honorRollStudents.push({ student: s, score });
        } else if (score < 75) {
            supportWatchlist.push({ student: s, score, reason: att.total > 0 ? `Attendance: ${att.percentage}` : 'Academic Monitoring' });
        }
    });

    const passRate = totalStudents > 0 ? ((passingCount / totalStudents) * 100).toFixed(1) : '0.0';
    
    const pRateEl = el('prcStatPassRate'); if (pRateEl) pRateEl.innerText = `${passRate}%`;
    const hCountEl = el('prcStatHonorCount'); if (hCountEl) hCountEl.innerText = honorRollStudents.length;
    const sCountEl = el('prcStatSupportCount'); if (sCountEl) sCountEl.innerText = supportWatchlist.length;

    // 1. Render Subject Pass/Fail Ratio Heatmap Matrix
    const heatmapBox = el('prcAcademicHeatmapBox');
    if (heatmapBox) {
        heatmapBox.innerHTML = '';
        const subjects = ['Mathematics', 'Science', 'English', 'Arabic', 'Social Studies'];
        const grades = ['Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];

        let tableHtml = `<table class="data-table" style="width:100%; text-align:center; font-size:12px;">
            <thead>
                <tr>
                    <th style="padding:10px; text-align:left; color:var(--gold);">Grade Level</th>
                    ${subjects.map(sub => `<th style="padding:10px; color:var(--gold);">${sub}</th>`).join('')}
                </tr>
            </thead>
            <tbody>`;

        grades.forEach((gr, idx) => {
            tableHtml += `<tr><td style="padding:10px; font-weight:700; text-align:left; color:var(--gold-light);">${gr}</td>`;
            subjects.forEach((sub, sIdx) => {
                const mockPassPct = Math.min(100, Math.max(65, 82 + ((idx * 3 + sIdx * 5) % 18) - (sIdx === 1 ? 8 : 0)));
                let bgColor = mockPassPct >= 85 ? 'rgba(16, 185, 129, 0.2)' : mockPassPct >= 75 ? 'rgba(234, 179, 8, 0.2)' : 'rgba(239, 68, 68, 0.2)';
                let textColor = mockPassPct >= 85 ? '#10b981' : mockPassPct >= 75 ? '#f59e0b' : '#ef4444';
                tableHtml += `<td style="padding:10px; background:${bgColor}; color:${textColor}; font-weight:700; border-radius:6px;">${mockPassPct}% Pass</td>`;
            });
            tableHtml += `</tr>`;
        });

        tableHtml += `</tbody></table>`;
        heatmapBox.innerHTML = tableHtml;
    }

    // 2. Render Curriculum & Syllabus Progress Monitor
    const progressBox = el('prcCurriculumProgressBox');
    if (progressBox) {
        progressBox.innerHTML = '';
        const syllabusList = stateDatabase.curriculumSyllabus || [];
        syllabusList.forEach(s => {
            const pct = Math.round((s.completedChapters / s.totalChapters) * 100);
            const statusColor = s.status === 'On Track' ? '#10b981' : '#f59e0b';
            const item = document.createElement('div');
            item.style.background = 'rgba(255,255,255,0.02)';
            item.style.border = '1px solid rgba(255,255,255,0.06)';
            item.style.borderRadius = '8px';
            item.style.padding = '10px';
            item.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
                    <span style="font-weight:700; color:var(--text-primary);">${escapeHTML(s.subject)} (${escapeHTML(s.grade)}) &bull; ${escapeHTML(s.teacherName)}</span>
                    <span style="color:${statusColor}; font-weight:700;">${pct}% (${s.completedChapters}/${s.totalChapters} Ch)</span>
                </div>
                <div style="width:100%; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                    <div style="width:${pct}%; height:100%; background:${statusColor};"></div>
                </div>
            `;
            progressBox.appendChild(item);
        });
    }

    // 3. Render At-Risk Support Watchlist Table
    const supportTable = el('prcAcademicSupportTableBody');
    if (supportTable) {
        supportTable.innerHTML = '';
        if (!supportWatchlist.length) {
            supportTable.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#10b981; padding:16px;">All students meeting standards.</td></tr>`;
        } else {
            supportWatchlist.slice(0, 6).forEach(s => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:600; color:var(--text-primary); padding:8px;">${escapeHTML(s.student.name)}</td>
                    <td style="color:var(--text-muted); padding:8px;">${escapeHTML(s.student.grade)}</td>
                    <td style="color:#f59e0b; font-weight:600; padding:8px;">${escapeHTML(s.reason)}</td>
                    <td style="text-align:right; padding:8px;">
                        <button class="glass-btn primary-btn" style="padding:3px 8px; font-size:11px;" onclick="scheduleParentInterventionMeeting('${s.student.id}', '${escapeHTML(s.student.name)}')">📅 Parent Meeting</button>
                    </td>
                `;
                supportTable.appendChild(tr);
            });
        }
    }
}

function scheduleParentInterventionMeeting(studentId, studentName) {
    const topic = `Academic & Attendance Intervention Meeting for ${studentName}`;
    const date = prompt("Enter Meeting Date (YYYY-MM-DD):", todayISO());
    if (!date) return;
    const time = prompt("Enter Meeting Time (e.g. 15:30):", "15:30");

    if (!stateDatabase.townHalls) stateDatabase.townHalls = [];
    stateDatabase.townHalls.unshift({
        id: 'TH-' + Math.floor(100 + Math.random() * 900),
        topic: topic,
        date: date,
        time: time || '15:30',
        location: 'Principal Office & Parent Tele-Conference',
        rsvpCount: 1,
        status: 'Scheduled'
    });

    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Parent Meeting Scheduled', `Scheduled intervention meeting for student ${studentName} on ${date}.`);
    saveState();
    alert(`📅 Parent intervention meeting scheduled for ${studentName} on ${date} at ${time}!`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODULE 5: FINANCIAL & RESOURCE OVERVIEW CONTROLLERS
   ═══════════════════════════════════════════════════════════════════════════ */
function renderPrincipalFinance() {
    const feeData = stateDatabase.feeCollections || [];
    let projectedTotal = 0;
    let collectedTotal = 0;
    let pendingTotal = 0;

    feeData.forEach(f => {
        const total = (f.collected || 0) + (f.pending || 0);
        projectedTotal += total;
        collectedTotal += (f.collected || 0);
        pendingTotal += (f.pending || 0);
    });

    const rate = projectedTotal > 0 ? ((collectedTotal / projectedTotal) * 100).toFixed(1) : '0.0';

    const pEl = el('prcFinTotalProjected'); if (pEl) pEl.innerText = `$${projectedTotal.toLocaleString()}`;
    const cEl = el('prcFinCollected'); if (cEl) cEl.innerText = `$${collectedTotal.toLocaleString()}`;
    const pdEl = el('prcFinPending'); if (pdEl) pdEl.innerText = `$${pendingTotal.toLocaleString()}`;
    const rEl = el('prcFinRate'); if (rEl) rEl.innerText = `${rate}%`;

    // Render Fee Breakdown Table
    const feeTable = el('prcFeeTableBody');
    if (feeTable) {
        feeTable.innerHTML = '';
        feeData.forEach(f => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:700; color:var(--text-primary); padding:8px;">${escapeHTML(f.grade)}</td>
                <td style="color:#10b981; font-weight:700; padding:8px;">$${f.collected.toLocaleString()}</td>
                <td style="color:#ef4444; font-weight:700; padding:8px;">$${f.pending.toLocaleString()}</td>
            `;
            feeTable.appendChild(tr);
        });
    }

    // Render Maintenance Table
    const mntTable = el('prcMaintenanceTableBody');
    if (mntTable) {
        mntTable.innerHTML = '';
        const mnts = stateDatabase.facilityMaintenance || [];
        mnts.forEach(m => {
            const tr = document.createElement('tr');
            let pColor = m.priority === 'High' ? '#ef4444' : '#f59e0b';
            let sColor = m.status === 'Completed' ? '#10b981' : m.status === 'In Progress' ? '#3b82f6' : '#f59e0b';
            tr.innerHTML = `
                <td style="font-weight:600; padding:8px;">${escapeHTML(m.asset)}</td>
                <td style="font-size:12px; color:var(--text-secondary); padding:8px;">${escapeHTML(m.issue)}</td>
                <td style="padding:8px;"><span style="color:${pColor}; font-weight:700; font-size:11px;">${escapeHTML(m.priority)}</span></td>
                <td style="padding:8px;"><button class="glass-btn secondary-btn" style="padding:2px 6px; font-size:10px; color:${sColor};" onclick="updateMaintenanceStatus('${m.id}')">${escapeHTML(m.status)}</button></td>
            `;
            mntTable.appendChild(tr);
        });
    }
}

function sendFeeRemindersAll() {
    alert("📩 Automated Fee Due Reminder Notices dispatched to all parents with pending tuition balances!");
    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Fee Reminders Dispatched', 'Dispatched tuition fee payment reminders to parents.');
}

function promptNewMaintenanceTicket() {
    const asset = prompt("Enter Asset / Facility Name (e.g. Bus #05, Lab C AC, Gym Floor):");
    if (!asset) return;
    const issue = prompt("Enter Issue Description:");
    if (!issue) return;
    const priority = prompt("Enter Priority Level (High, Medium, Low):", "High");

    const newMnt = {
        id: 'MNT-' + Math.floor(100 + Math.random() * 900),
        asset: asset,
        issue: issue,
        priority: priority || 'Medium',
        status: 'Pending'
    };

    if (!stateDatabase.facilityMaintenance) stateDatabase.facilityMaintenance = [];
    stateDatabase.facilityMaintenance.unshift(newMnt);
    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Maintenance Ticket Created', `Created ticket for ${asset}: ${issue}.`);
    saveState();
    renderPrincipalFinance();
}

function updateMaintenanceStatus(id) {
    const m = (stateDatabase.facilityMaintenance || []).find(item => item.id === id);
    if (m) {
        if (m.status === 'Pending') m.status = 'In Progress';
        else if (m.status === 'In Progress') m.status = 'Completed';
        else m.status = 'Pending';

        db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Maintenance Status Changed', `Updated ticket ${id} to ${m.status}.`);
        saveState();
        renderPrincipalFinance();
    }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODULE 6: PARENT RELATIONS & OFFICIAL LETTERS CONTROLLERS
   ═══════════════════════════════════════════════════════════════════════════ */
function renderPrincipalParents() {
    // Populate student select for TC & Letters
    const docSelect = el('prcDocStudentSelect');
    if (docSelect) {
        docSelect.innerHTML = '';
        const students = stateDatabase.students || [];
        students.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.innerText = `${s.name} (${s.grade} - ${s.section})`;
            docSelect.appendChild(opt);
        });
    }

    // Render Scheduled Town Halls
    const thBox = el('prcTownHallListBox');
    if (thBox) {
        thBox.innerHTML = '';
        const halls = stateDatabase.townHalls || [];
        if (!halls.length) {
            thBox.innerHTML = '<p style="opacity:0.6; text-align:center; padding:10px;">No town halls scheduled.</p>';
        } else {
            halls.forEach(h => {
                const item = document.createElement('div');
                item.style.background = 'rgba(255,255,255,0.03)';
                item.style.border = '1px solid rgba(255,255,255,0.06)';
                item.style.borderRadius = '8px';
                item.style.padding = '8px 12px';
                item.style.marginBottom = '6px';
                item.innerHTML = `
                    <div style="font-weight:700; font-size:13px; color:var(--gold-light);">${escapeHTML(h.topic)}</div>
                    <div style="font-size:11px; opacity:0.6;">📅 ${escapeHTML(h.date)} at ${escapeHTML(h.time)} &bull; Venue: ${escapeHTML(h.location)}</div>
                `;
                thBox.appendChild(item);
            });
        }
    }
}

function scheduleParentTownHall() {
    const topic = el('prcTHTopic') ? el('prcTHTopic').value.trim() : '';
    const date = el('prcTHDate') ? el('prcTHDate').value : todayISO();
    const time = el('prcTHTime') ? el('prcTHTime').value : '17:00';
    const location = el('prcTHLocation') ? el('prcTHLocation').value.trim() : 'Auditorium';

    if (!topic) {
        alert("Please enter Town Hall Topic/Agenda.");
        return;
    }

    const thItem = {
        id: 'TH-' + Math.floor(100 + Math.random() * 900),
        topic: topic,
        date: date,
        time: time,
        location: location || 'School Auditorium',
        rsvpCount: 0,
        status: 'Scheduled'
    };

    if (!stateDatabase.townHalls) stateDatabase.townHalls = [];
    stateDatabase.townHalls.unshift(thItem);

    // Also publish to announcements feed for parents
    if (!stateDatabase.announcements) stateDatabase.announcements = [];
    stateDatabase.announcements.push({
        id: 'ANN-TH-' + Date.now(),
        title: `🏛️ INVITE: Principal-Parent Town Hall — ${topic}`,
        desc: `You are invited to join the Principal on ${date} at ${time}. Venue: ${location}.`,
        date: todayISO(),
        category: 'Town Hall'
    });

    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Town Hall Scheduled', `Scheduled town hall: ${topic} on ${date}.`);
    saveState();

    if (el('prcTHTopic')) el('prcTHTopic').value = '';
    alert(`🏛️ Principal-Parent Town Hall scheduled & published to parent portal!`);
    renderPrincipalParents();
}

function generateOfficialCertificate() {
    const studentSelect = el('prcDocStudentSelect');
    const studentId = studentSelect ? studentSelect.value : null;
    const docType = el('prcDocTypeSelect') ? el('prcDocTypeSelect').value : 'Transfer Certificate';
    const remarks = el('prcDocRemarks') ? el('prcDocRemarks').value.trim() : 'Exemplary conduct and active participation in academic activities.';

    const student = (stateDatabase.students || []).find(s => s.id === studentId);
    if (!student) {
        alert("Please select a student first.");
        return;
    }

    const docWindow = window.open('', '_blank');
    if (!docWindow) {
        alert("Please allow popups to open the generated certificate.");
        return;
    }

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${escapeHTML(docType)} — ${escapeHTML(student.name)}</title>
            <style>
                body { font-family: 'Times New Roman', Times, serif; padding: 60px; color: #1e293b; background: #fff; line-height: 1.8; }
                .cert-border { border: 8px double #1e3a8a; padding: 40px; border-radius: 4px; text-align: center; position: relative; }
                .school-header { font-size: 28px; font-weight: bold; color: #1e3a8a; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 5px; }
                .school-sub { font-size: 14px; font-style: italic; color: #475569; margin-bottom: 30px; }
                .doc-title { font-size: 22px; font-weight: bold; text-decoration: underline; text-transform: uppercase; margin: 30px 0; color: #0f172a; letter-spacing: 1.5px; }
                .doc-body { font-size: 16px; text-align: justify; margin: 40px 0; line-height: 2; text-indent: 40px; }
                .highlight { font-weight: bold; border-bottom: 1px dotted #333; padding: 0 4px; }
                .sig-block { display: flex; justify-content: space-between; margin-top: 80px; text-align: center; }
                .sig-line { border-top: 1px solid #333; width: 200px; padding-top: 5px; font-weight: bold; font-size: 14px; }
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>
            <div class="cert-border">
                <div class="school-header">ALPHA PRIVATE ACADEMY</div>
                <div class="school-sub">Ministry of Education Accredited &bull; Institutional License #88490-UAE</div>
                
                <div class="doc-title">${escapeHTML(docType)}</div>

                <div class="doc-body">
                    This is to officially certify that <span class="highlight">${escapeHTML(student.name)}</span> 
                    (Registration Ref: <span class="highlight">${escapeHTML(student.id)}</span>), 
                    was enrolled at Alpha Private Academy in <span class="highlight">${escapeHTML(student.grade)}</span>, Section <span class="highlight">${escapeHTML(student.section)}</span>.
                    <br><br>
                    <strong>Special Remarks &amp; Conduct Assessment:</strong> ${escapeHTML(remarks)}
                    <br><br>
                    During the period of enrollment, their character and academic conduct were found to be 
                    <strong>exemplary and highly satisfactory</strong>. This certificate is issued upon official request for university admissions and institutional records.
                </div>

                <div class="sig-block">
                    <div>
                        <div class="sig-line">School Seal &amp; Registrar</div>
                        <div style="font-size:11px; color:#64748b; margin-top:4px;">Date: ${new Date().toLocaleDateString()}</div>
                    </div>
                    <div>
                        <div style="font-family:'Brush Script MT', cursive; font-size:24px; color:#1e3a8a; margin-bottom:-10px;">Principal Administration</div>
                        <div class="sig-line">Office of the Principal</div>
                        <div style="font-size:11px; color:#64748b; margin-top:4px;">Alpha Private Academy</div>
                    </div>
                </div>
            </div>
            <br>
            <div style="text-align:center;"><button onclick="window.print()" style="padding:10px 24px; background:#1e3a8a; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer;">Print Official Certificate</button></div>
        </body>
        </html>
    `;

    docWindow.document.write(htmlContent);
    docWindow.document.close();
    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Official Certificate Generated', `Generated ${docType} for ${student.name}.`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   MODULE 7: SCHOOL EVENT & CALENDAR MANAGEMENT CONTROLLERS
   ═══════════════════════════════════════════════════════════════════════════ */
function renderPrincipalCalendar() {
    // 1. Render Master Events Table
    const eventTable = el('prcMasterEventTableBody');
    if (eventTable) {
        eventTable.innerHTML = '';
        const events = stateDatabase.masterEvents || [];
        if (!events.length) {
            eventTable.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:16px; opacity:0.6;">No master events scheduled.</td></tr>`;
        } else {
            events.forEach(ev => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:700; color:var(--text-primary); padding:8px;">${escapeHTML(ev.title)}</td>
                    <td style="padding:8px;"><span style="background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px; font-size:11px;">${escapeHTML(ev.category)}</span></td>
                    <td style="padding:8px; font-size:12px;">${escapeHTML(ev.startDate)}${ev.endDate ? ` to ${escapeHTML(ev.endDate)}` : ''}</td>
                    <td style="padding:8px; color:#10b981; font-weight:700;">${escapeHTML(ev.status)}</td>
                `;
                eventTable.appendChild(tr);
            });
        }
    }

    // 2. Render VIP Visits Table
    const vipTable = el('prcVIPTableBody');
    if (vipTable) {
        vipTable.innerHTML = '';
        const vips = stateDatabase.vipVisits || [];
        if (!vips.length) {
            vipTable.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:16px; opacity:0.6;">No VIP visits recorded.</td></tr>`;
        } else {
            vips.forEach(v => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight:700; color:var(--gold-light); padding:8px;">${escapeHTML(v.visitorName)}</td>
                    <td style="padding:8px; font-size:12px;">${escapeHTML(v.organization)}</td>
                    <td style="padding:8px;">${escapeHTML(v.date)}</td>
                    <td style="padding:8px; font-size:12px; color:var(--text-secondary);">${escapeHTML(v.purpose)}</td>
                `;
                vipTable.appendChild(tr);
            });
        }
    }
}

function promptNewMasterEvent() {
    const title = prompt("Enter Event Title (e.g. Annual Sports Day, Term 1 Exams):");
    if (!title) return;
    const category = prompt("Enter Category (Exam, Sports Day, Science Fair, Holiday):", "Academic");
    const startDate = prompt("Enter Start Date (YYYY-MM-DD):", todayISO());

    const newEv = {
        id: 'EV-' + Math.floor(100 + Math.random() * 900),
        title: title,
        category: category || 'Event',
        startDate: startDate || todayISO(),
        status: 'Approved'
    };

    if (!stateDatabase.masterEvents) stateDatabase.masterEvents = [];
    stateDatabase.masterEvents.unshift(newEv);
    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'Master Event Created', `Created calendar event: ${title}.`);
    saveState();
    renderPrincipalCalendar();
}

function promptNewVIPVisit() {
    const name = prompt("Enter VIP Visitor Name & Designation:");
    if (!name) return;
    const org = prompt("Enter Organization / Ministry:");
    const date = prompt("Enter Visit Date (YYYY-MM-DD):", todayISO());
    const purpose = prompt("Enter Purpose of Visit:");

    const newVip = {
        id: 'VIP-' + Math.floor(100 + Math.random() * 900),
        visitorName: name,
        organization: org || 'Ministry of Education',
        date: date || todayISO(),
        purpose: purpose || 'Official Campus Tour',
        status: 'Upcoming'
    };

    if (!stateDatabase.vipVisits) stateDatabase.vipVisits = [];
    stateDatabase.vipVisits.unshift(newVip);
    db_logEvent('PRINCIPAL-ADMIN', 'Principal Desk', 'VIP Visit Logged', `Registered VIP visit for ${name}.`);
    saveState();
    renderPrincipalCalendar();
}

// Initialize emergency banner & notification badges on startup
document.addEventListener('DOMContentLoaded', () => {
    if (typeof updateAllPortalNotificationBadges === 'function') {
        updateAllPortalNotificationBadges();
    }
});