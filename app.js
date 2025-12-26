import { auth, db, provider } from './firebase-config.js';
import { 
    signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, 
    signInWithEmailAndPassword, createUserWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, 
    serverTimestamp, where, limit, deleteDoc, updateDoc, arrayUnion, arrayRemove 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentExam = null;
let examTimer = null;
let currentChatNoteId = null;
let currentAssignId = null;
let isExamActive = false;
let cheatWarnings = 2;
let allNotes = [];

// --- 1. AUTHENTICATION ---
async function checkRedirect() {
    try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
            document.getElementById('login-status').innerText = "Verifying Account...";
            handleUser(result.user);
        }
    } catch (error) {
        alert("Login Error: " + error.message);
    }
}
checkRedirect();

const loginBtn = document.getElementById('email-login-btn');
const setupBtn = document.getElementById('setup-btn');

if (loginBtn) {
    // Email Login
    loginBtn.addEventListener('click', async () => {
        const e = document.getElementById('email').value.trim();
        const p = document.getElementById('password').value;
        if (!e || !p) return alert("Please enter email and password.");
        try {
            await signInWithEmailAndPassword(auth, e, p);
        } catch (err) {
            alert(err.message.replace("Firebase:", ""));
        }
    });

    // Account Setup (First Time)
    setupBtn.addEventListener('click', async () => {
        const e = document.getElementById('email').value.trim();
        const p = document.getElementById('password').value;
        
        if (loginBtn.innerText === "Login") {
            loginBtn.innerText = "Create Account";
            setupBtn.innerText = "Back to Login";
            alert("Enter your Email and a NEW Password to register.");
            return;
        }

        try {
            // Check whitelist
            const q = query(collection(db, "students"), where("email", "==", e));
            const snap = await getDocs(q);
            if (snap.empty) throw new Error("This email is not registered by the Admin.");

            // Create Auth
            const uc = await createUserWithEmailAndPassword(auth, e, p);
            const user = uc.user;
            const preData = snap.docs[0].data();
            const oldId = snap.docs[0].id;

            // Link Data
            await setDoc(doc(db, "students", user.uid), {
                ...preData,
                uid: user.uid,
                photo: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
                approved: true
            });

            if (oldId !== user.uid) await deleteDoc(doc(db, "students", oldId));
            
            alert("Account Created! Logging in...");
        } catch (err) {
            alert(err.message);
            loginBtn.innerText = "Login";
        }
    });
}

document.getElementById('google-login-btn')?.addEventListener('click', async () => {
    try {
        await signInWithRedirect(auth, provider);
    } catch (e) {
        alert("Google Error: " + e.message);
    }
});

onAuthStateChanged(auth, (user) => {
    if (user) handleUser(user);
    else showLoginScreen();
});

// --- 2. USER HANDLING & SECURITY ---
async function handleUser(user) {
    try {
        const userRef = doc(db, "students", user.uid);
        let snap = await getDoc(userRef);

        if (snap.exists()) {
            const data = snap.data();
            
            // DEVICE LOCK CHECK
            const localId = localStorage.getItem('did') || crypto.randomUUID();
            if (!localStorage.getItem('did')) localStorage.setItem('did', localId);

            if (data.deviceId && data.deviceId !== localId) {
                alert("⛔ Security Alert: You are logged in on another device.\nContact Admin to reset.");
                await signOut(auth);
                location.reload();
                return;
            }
            
            if (!data.deviceId) await updateDoc(userRef, { deviceId: localId });

            currentUser = data;
            initDashboard();
        } else {
            // Fallback for Google Users not yet linked
            const q = query(collection(db, "students"), where("email", "==", user.email));
            const s = await getDocs(q);
            
            if (!s.empty) {
                const preData = s.docs[0].data();
                const oldId = s.docs[0].id;
                
                await setDoc(doc(db, "students", user.uid), {
                    ...preData,
                    uid: user.uid,
                    name: user.displayName,
                    photo: user.photoURL,
                    approved: true
                });
                
                if (oldId !== user.uid) await deleteDoc(doc(db, "students", oldId));
                currentUser = { ...preData, uid: user.uid, name: user.displayName, photo: user.photoURL };
                initDashboard();
            } else {
                alert("⛔ Access Denied: Your email is not allowed.");
                await signOut(auth);
                location.reload();
            }
        }
    } catch (e) {
        console.error(e);
        alert("System Error. Check Console.");
    }
}

function showLoginScreen() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
}

function initDashboard() {
    checkMaint();
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    // UI Fill
    document.getElementById('profile-name').innerText = currentUser.name;
    document.getElementById('header-name').innerText = currentUser.name.split(' ')[0];
    document.getElementById('nav-photo').src = currentUser.photo;
    document.getElementById('profile-photo').src = currentUser.photo;
    document.getElementById('profile-email').innerText = currentUser.email;
    document.getElementById('edit-phone').value = currentUser.phone || "";
    document.getElementById('edit-bio').value = currentUser.bio || "";

    if (currentUser.role === 'admin') {
        document.getElementById('admin-link-btn').classList.remove('hidden');
    }

    // Load Features
    updateXPUI();
    checkStreak();
    loadLive();
    loadNotes();
    loadVideos();
    loadCards();
    loadExams();
    loadEvents();
    loadAssignments();
    loadNotifs();
    renderAttendance();
    loadMyTasks();
}

async function checkMaint() {
    const s = await getDoc(doc(db, "settings", "system"));
    if (s.exists() && s.data().maintenance && currentUser.role !== 'admin') {
        document.body.innerHTML = "<div class='h-screen flex items-center justify-center bg-slate-900 text-white p-4 text-center'><div><i class='fas fa-tools text-4xl text-yellow-500 mb-4'></i><h1 class='text-2xl font-bold'>Under Maintenance</h1><p>We are upgrading the system.</p></div></div>";
    }
}

// --- 3. LEARNING CONTENT (BATCH FILTERED) ---
async function loadNotes() {
    const myBatch = currentUser.batch || "all";
    const snaps = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
    const list = document.getElementById('notes-list'); 
    list.innerHTML = "";
    allNotes = [];

    snaps.forEach(doc => {
        const n = doc.data();
        // Filter: Show if batch is 'all' or matches student's batch
        if (n.batch === "all" || n.batch === myBatch) {
            allNotes.push({id: doc.id, ...n});
            const isFav = currentUser.bookmarks?.includes(doc.id);
            list.innerHTML += `
            <div class="bg-white p-3 rounded-xl border border-slate-100 flex items-center gap-3 shadow-sm relative">
                <div onclick="openViewer('${n.url}','${n.type}','${doc.id}')" class="flex-grow flex items-center gap-3 cursor-pointer">
                    <div class="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                        <i class="fas ${n.type==='pdf'?'fa-file-pdf':'fa-image'}"></i>
                    </div>
                    <div>
                        <h4 class="font-bold text-xs text-slate-700 truncate w-32">${n.title}</h4>
                        <span class="text-[9px] text-slate-400 bg-slate-50 px-1 rounded">${n.subject || 'Gen'}</span>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="speak('${n.title}')" class="text-slate-300 hover:text-blue-500"><i class="fas fa-volume-up"></i></button>
                    <button onclick="toggleFav('${doc.id}')" class="${isFav ? 'text-red-500' : 'text-slate-300'} hover:text-red-500"><i class="fas fa-heart"></i></button>
                </div>
            </div>`;
        }
    });
}

window.toggleFav = async (id) => {
    const isFav = currentUser.bookmarks?.includes(id);
    await updateDoc(doc(db, "students", currentUser.uid), { bookmarks: isFav ? arrayRemove(id) : arrayUnion(id) });
    // Update local state and reload to reflect change
    if(isFav) currentUser.bookmarks = currentUser.bookmarks.filter(x => x !== id);
    else currentUser.bookmarks = [...(currentUser.bookmarks || []), id];
    loadNotes();
};

window.speak = (txt) => {
    const s = new SpeechSynthesisUtterance(txt);
    window.speechSynthesis.speak(s);
};

// --- 4. EXAM SYSTEM (HYBRID + REVIEW) ---
async function loadExams() {
    const myBatch = currentUser.batch || "all";
    const snaps = await getDocs(query(collection(db, "exams"), orderBy("createdAt", "desc")));
    const resSnaps = await getDocs(query(collection(db, "results"), where("studentId", "==", currentUser.uid)));
    const takenIds = [];
    resSnaps.forEach(doc => takenIds.push(doc.data().examId));

    const list = document.getElementById('exams-list');
    list.innerHTML = "";

    if (snaps.empty) list.innerHTML = "<p class='text-xs text-gray-400 p-2'>No exams available.</p>";

    snaps.forEach(doc => {
        const e = doc.data();
        // Batch Filter for Exams too!
        if (e.batch === "all" || !e.batch || e.batch === myBatch) {
            const isTaken = takenIds.includes(doc.id);
            list.innerHTML += `
            <div class="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg flex items-center justify-center ${isTaken?'bg-green-100 text-green-600':'bg-indigo-100 text-indigo-600'}">
                        <i class="fas ${isTaken?'fa-check':'fa-pen'}"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-slate-700 text-xs truncate w-32">${e.title}</h3>
                        <p class="text-[10px] text-slate-400">${e.duration}m • ${e.type === 'pdf_exam' ? e.answerKey.length : e.questions.length}Q</p>
                    </div>
                </div>
                ${!isTaken 
                    ? `<button onclick="startExam('${doc.id}')" class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm">Start</button>` 
                    : `<button onclick="openReview('${doc.id}')" class="bg-white border text-slate-500 px-3 py-1.5 rounded-lg text-xs font-bold">Review</button>`}
            </div>`;
        }
    });
}

// Anti-Cheat
document.addEventListener("visibilitychange", () => {
    if (isExamActive && document.hidden) showCheatWarning();
});

function showCheatWarning() {
    const o = document.getElementById('cheat-warning');
    o.classList.remove('hidden');
    cheatWarnings--;
    document.getElementById('cheat-count').innerText = cheatWarnings;
    if (cheatWarnings < 0) {
        isExamActive = false;
        o.classList.add('hidden');
        alert("⛔ Exam Terminated due to tab switching.");
        submitExam();
    }
}
window.resumeExam = () => document.getElementById('cheat-warning').classList.add('hidden');

window.startExam = async (eid) => {
    isExamActive = true;
    cheatWarnings = 2;
    const docSnap = await getDoc(doc(db, "exams", eid));
    currentExam = { id: docSnap.id, ...docSnap.data() };
    
    document.getElementById('exam-taker-modal').classList.remove('hidden');
    document.getElementById('taking-exam-title').innerText = currentExam.title;
    
    const qArea = document.getElementById('exam-questions-area');
    qArea.innerHTML = "";
    const pdfPanel = document.getElementById('pdf-panel');

    if (currentExam.type === "pdf_exam") {
        pdfPanel.classList.remove('hidden');
        document.getElementById('exam-pdf-frame').src = currentExam.fileUrl;
        const total = currentExam.answerKey.length;
        for (let i = 0; i < total; i++) {
            qArea.innerHTML += `<div class="flex items-center justify-between bg-white p-2 mb-2 rounded border"><span class="font-bold text-xs w-6">Q${i+1}</span><div class="flex gap-3">${['A','B','C','D'].map((o,ox)=>`<label><input type="radio" name="q-${i}" value="${ox}"> <span class="text-xs font-bold text-slate-500">${o}</span></label>`).join('')}</div></div>`;
        }
    } else {
        pdfPanel.classList.add('hidden');
        currentExam.questions.forEach((q, i) => {
            qArea.innerHTML += `<div class="bg-white p-4 mb-3 rounded-xl border shadow-sm"><p class="font-bold text-sm mb-2 text-slate-800">Q${i+1}. ${q.text}</p>${q.options.map((o,ox)=>`<label class="block bg-slate-50 p-2 rounded mb-1 text-xs"><input type="radio" name="q-${i}" value="${ox}"> ${o}</label>`).join('')}</div>`;
        });
    }

    let time = currentExam.duration * 60;
    examTimer = setInterval(() => {
        time--;
        document.getElementById('timer-display').innerText = time;
        if (time <= 0) submitExam();
    }, 1000);
};

window.submitExam = async () => {
    clearInterval(examTimer);
    isExamActive = false;
    let score = 0;
    const userAnswers = [];
    const total = currentExam.type === "pdf_exam" ? currentExam.answerKey.length : currentExam.questions.length;

    for (let i = 0; i < total; i++) {
        const sel = document.querySelector(`input[name="q-${i}"]:checked`);
        const val = sel ? parseInt(sel.value) : -1;
        userAnswers.push(val);
        const correct = currentExam.type === "pdf_exam" ? currentExam.answerKey[i] : currentExam.questions[i].correct;
        if (val === correct) score++;
    }

    // Gamification
    const xpGain = score * 10;
    await updateDoc(doc(db, "students", currentUser.uid), { xp: (currentUser.xp || 0) + xpGain });

    // Save Result
    await addDoc(collection(db, "results"), {
        examId: currentExam.id,
        examTitle: currentExam.title,
        studentId: currentUser.uid,
        studentName: currentUser.name,
        score,
        total,
        userAnswers,
        submittedAt: serverTimestamp()
    });

    document.getElementById('exam-taker-modal').classList.add('hidden');
    document.getElementById('exam-pdf-frame').src = ""; // Clear memory

    if ((score / total) * 100 >= 80) {
        document.getElementById('cert-modal').classList.remove('hidden');
        document.getElementById('cert-name').innerText = currentUser.name;
        document.getElementById('cert-exam').innerText = currentExam.title;
    } else {
        alert(`Score: ${score}/${total}`);
    }
    location.reload();
};

window.openReview = async (eid) => {
    const e = await getDoc(doc(db, "exams", eid));
    const ed = e.data();
    const q = query(collection(db, "results"), where("examId", "==", eid), where("studentId", "==", currentUser.uid));
    const rs = await getDocs(q);
    
    if(rs.empty) return alert("Error: Result missing.");
    const r = rs.docs[0].data();
    const ua = r.userAnswers;

    document.getElementById('review-modal').classList.remove('hidden');
    const c = document.getElementById('review-content');
    c.innerHTML = "";

    if (ed.type === "pdf_exam") {
        c.innerHTML = `<div class="grid grid-cols-5 gap-2">${ed.answerKey.map((k,i)=>`<div class="border p-2 rounded text-center text-xs ${ua[i]===k?'bg-green-100':'bg-red-100'}"><b>Q${i+1}</b><br>Ans:${['A','B','C','D'][k]}<br>You:${['A','B','C','D'][ua[i]]||'-'}</div>`).join('')}</div>`;
    } else {
        ed.questions.forEach((q, i) => {
            c.innerHTML += `<div class="p-3 border rounded mb-2 text-xs ${ua[i]===q.correct?'bg-green-50':'bg-red-50'}"><p><b>Q${i+1}</b> ${q.text}</p><p>You: ${q.options[ua[i]]||'-'} ${ua[i]===q.correct?'✅':'❌'}</p>${ua[i]!==q.correct?`<p class="text-green-600">Correct: ${q.options[q.correct]}</p>`:''}</div>`;
        });
    }
};

// --- 5. CLASSROOM FEATURES ---
// Chat
window.openViewer = (url, type, id) => {
    currentChatNoteId = id;
    document.getElementById('viewer-modal').classList.remove('hidden');
    document.getElementById('pdf-frame').src = url;
};
window.toggleDiscuss = () => {
    if (currentChatNoteId) {
        document.getElementById('discussion-modal').classList.remove('hidden');
        loadChat();
    }
};
async function loadChat() {
    const b = document.getElementById('chat-box'); b.innerHTML = "Loading...";
    const snaps = await getDocs(query(collection(db, "comments"), where("noteId", "==", currentChatNoteId), orderBy("createdAt", "asc")));
    b.innerHTML = "";
    snaps.forEach(doc => {
        const c = doc.data();
        const mine = c.userId === currentUser.uid;
        b.innerHTML += `<div class="chat-bubble ${mine?'chat-mine':'chat-others'}"><p class="font-bold text-[9px] opacity-70">${c.userName}</p><p>${c.text}</p></div>`;
    });
}
window.sendChat = async () => {
    const t = document.getElementById('chat-input').value; if (!t) return;
    await addDoc(collection(db, "comments"), { noteId: currentChatNoteId, userId: currentUser.uid, userName: currentUser.name, text: t, createdAt: serverTimestamp() });
    document.getElementById('chat-input').value = ""; loadChat();
};

// Assignments
async function loadAssignments() {
    const list = document.getElementById('assignment-list'); list.innerHTML = "";
    const snaps = await getDocs(query(collection(db, "assignments"), orderBy("dueDate", "asc")));
    snaps.forEach(doc => {
        const a = doc.data();
        list.innerHTML += `<div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex justify-between items-center"><div><h4 class="font-bold text-sm text-slate-800">${a.title}</h4><span class="text-[10px] text-indigo-500">Due: ${a.dueDate}</span></div><button onclick="openSubmit('${doc.id}','${a.title}')" class="text-xs bg-indigo-50 text-indigo-600 px-3 py-1 rounded font-bold">Upload</button></div>`;
    });
}
window.openSubmit = (id, title) => { currentAssignId = id; document.getElementById('submit-task-title').innerText = title; document.getElementById('submit-modal').classList.remove('hidden'); };
window.submitHomework = async () => {
    const file = document.getElementById('hw-file').files[0]; if (!file) return alert("Select file");
    const f = new FormData(); f.append('file', file); f.append('upload_preset', 'lms_upload');
    const r = await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload', { method: 'POST', body: f });
    const d = await r.json();
    await addDoc(collection(db, "submissions"), { assignmentId: currentAssignId, studentId: currentUser.uid, studentName: currentUser.name, fileUrl: d.secure_url, graded: false, submittedAt: serverTimestamp() });
    alert("Submitted"); document.getElementById('submit-modal').classList.add('hidden');
};

// Attendance & Streak
async function checkStreak() {
    const t = new Date().toDateString();
    if (currentUser.lastLogin !== t) {
        const d = new Date(); d.setDate(d.getDate() - 1);
        let s = (currentUser.lastLogin === d.toDateString()) ? (currentUser.streak || 0) + 1 : 1;
        await updateDoc(doc(db, "students", currentUser.uid), { lastLogin: t, streak: s, attendance: arrayUnion(t) });
        document.getElementById('streak-count').innerText = s;
        if (currentUser.attendance) currentUser.attendance.push(t); else currentUser.attendance = [t];
    } else { document.getElementById('streak-count').innerText = currentUser.streak || 0; }
}
function renderAttendance() {
    const g = document.getElementById('attendance-grid'); g.innerHTML = "";
    const days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    for (let i = 1; i <= days; i++) {
        const d = new Date(new Date().getFullYear(), new Date().getMonth(), i).toDateString();
        g.innerHTML += `<div class="cal-day ${currentUser.attendance?.includes(d)?'cal-present':''}">${i}</div>`;
    }
}

// --- 6. MISC UTILS ---
async function loadVideos() { const s=await getDocs(query(collection(db,"videos"))); const l=document.getElementById('video-list'); l.innerHTML=""; s.forEach(d=>{ const v=d.data(); const vid=v.url.split('v=')[1]?.split('&')[0]||v.url.split('/').pop(); l.innerHTML+=`<div class="bg-white p-3 rounded-xl border shadow-sm"><div class="video-wrapper mb-2"><iframe src="https://www.youtube.com/embed/${vid}" allowfullscreen></iframe></div><h4 class="font-bold text-slate-800 text-sm">${v.title}</h4></div>`; }); }
async function loadCards() { const s=await getDocs(query(collection(db,"flashcards"))); const l=document.getElementById('card-list'); l.innerHTML=""; s.forEach(d=>{ const c=d.data(); l.innerHTML+=`<div class="flashcard-container" onclick="this.classList.toggle('flipped')"><div class="flashcard-inner"><div class="flashcard-front"><p>${c.front}</p></div><div class="flashcard-back"><p>${c.back}</p></div></div></div>`; }); }
async function loadEvents() { const s=await getDocs(query(collection(db,"events"), orderBy("date","asc"))); const l=document.getElementById('events-list'); l.innerHTML=""; s.forEach(d=>{ const e=d.data(); l.innerHTML+=`<div class="flex gap-3 bg-white p-2 rounded border"><div class="bg-orange-50 text-orange-600 px-2 py-1 rounded text-center"><span class="block font-bold text-sm">${new Date(e.date).getDate()}</span></div><div><h4 class="font-bold text-xs text-slate-800">${e.title}</h4><span class="text-[9px] text-slate-400">Upcoming</span></div></div>`; }); }
async function loadMyTasks() { const s=await getDocs(query(collection(db,"tasks"), where("uid","==",currentUser.uid))); const l=document.getElementById('my-task-list'); l.innerHTML=""; s.forEach(d=>{ l.innerHTML+=`<div class="flex justify-between bg-slate-50 p-2 rounded text-xs"><span>${d.data().text}</span><button onclick="delTask('${d.id}')" class="text-red-500">x</button></div>`; }); }
window.addMyTask = async () => { const t=document.getElementById('my-task-in').value; if(t){ await addDoc(collection(db,"tasks"),{uid:currentUser.uid, text:t}); document.getElementById('my-task-in').value=""; loadMyTasks(); } };
window.delTask = async (id) => { await deleteDoc(doc(db,"tasks",id)); loadMyTasks(); };
function updateXPUI() { const xp = currentUser.xp||0; document.getElementById('xp-text').innerText = xp+" XP"; document.getElementById('xp-bar').style.width = Math.min((xp/1000)*100, 100)+"%"; }
async function loadLive() { const s=await getDoc(doc(db,"settings","live")); if(s.exists()&&s.data().active) { document.getElementById('live-class-card').classList.remove('hidden'); document.getElementById('live-link').href=s.data().url; } }
async function loadNotifs() { const s=await getDocs(query(collection(db,"notifications"), orderBy("createdAt","desc"), limit(5))); const l=document.getElementById('notif-dropdown'); l.innerHTML=""; s.forEach(d=>{ l.innerHTML+=`<div class="p-2 border-b text-xs"><p class="font-bold">${d.data().title}</p></div>`; document.getElementById('notif-badge').classList.remove('hidden'); }); }
window.toggleNotifs = () => document.getElementById('notif-dropdown').classList.toggle('hidden');
window.openProfileModal = () => document.getElementById('profile-modal').classList.remove('hidden');
window.closeViewer = () => { document.getElementById('viewer-modal').classList.add('hidden'); document.getElementById('pdf-frame').src=""; };
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth).then(()=>location.reload()));
window.switchTab = (tab) => { ['notes','videos','cards','exams','tasks','events'].forEach(t => { document.getElementById(`view-${t}`).classList.toggle('hidden', t!==tab); document.getElementById(`tab-${t}`).classList.toggle('active-tab', t===tab); }); };
window.toggleTheme = () => { document.body.classList.toggle('dark'); };
window.calcApp = (v) => { const d = document.getElementById('calc-display'); if(v==='C') d.value='0'; else if(v==='DEL') d.value=d.value.slice(0,-1); else d.value+=v; };
window.calcSolve = () => { try { document.getElementById('calc-display').value = eval(document.getElementById('calc-display').value); } catch{ document.getElementById('calc-display').value="Err"; } };
window.saveProfile = async () => { await updateDoc(doc(db,"students",currentUser.uid), { phone:document.getElementById('edit-phone').value, bio:document.getElementById('edit-bio').value }); location.reload(); };
window.uploadProfilePhoto = async (inp) => { const f=inp.files[0]; const fm=new FormData(); fm.append('file',f); fm.append('upload_preset','lms_upload'); const r=await fetch('https://api.cloudinary.com/v1_1/dpe74ejhl/upload',{method:'POST',body:fm}); const d=await r.json(); await updateDoc(doc(db,"students",currentUser.uid), { photo:d.secure_url }); location.reload(); };
document.getElementById('global-search').addEventListener('input', (e) => { const term = e.target.value.toLowerCase(); renderNotes(allNotes.filter(n => n.title.toLowerCase().includes(term))); });