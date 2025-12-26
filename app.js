// app.js
import { auth, db, provider } from './firebase-config.js';
import { 
    signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, getDoc, setDoc, collection, addDoc, getDocs, query, orderBy, serverTimestamp, where, limit, deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let currentUser = null;
let currentExam = null;
let examTimer = null;
let allNotes = [];
let allExams = [];

// --- UTILS ---
function showToast(msg, type = 'neutral') {
    const box = document.getElementById('toast-container');
    const el = document.createElement('div');
    const icon = type === 'success' ? 'check-circle text-green-400' : (type === 'error' ? 'exclamation-circle text-red-400' : 'info-circle text-blue-400');
    el.className = "toast";
    el.innerHTML = `<i class="fas fa-${icon}"></i> <span>${msg}</span>`;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

// --- AUTH LOGIC (Mobile Friendly) ---

// 1. Check for Redirect Result (Runs on page load after Google)
async function checkRedirect() {
    try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
            handleUser(result.user);
        }
    } catch (error) {
        alert("Login Error: " + error.message);
    }
}
checkRedirect();

// 2. Login Button
const loginBtn = document.getElementById('google-login-btn');
if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        loginBtn.disabled = true;
        loginBtn.innerHTML = "🔄 Redirecting...";
        try {
            await signInWithRedirect(auth, provider);
        } catch (error) {
            alert("Connection Error: " + error.message);
            loginBtn.disabled = false;
            loginBtn.innerHTML = "Try Again";
        }
    });
}

// 3. Auth Listener
onAuthStateChanged(auth, (user) => {
    if (user) handleUser(user);
    else showLoginScreen();
});

// 4. Strict User Handling
async function handleUser(user) {
    try {
        const userRef = doc(db, "students", user.uid);
        let snap = await getDoc(userRef);

        if (snap.exists()) {
            currentUser = snap.data();
            initDashboard();
            return;
        }

        // Check pre-registration by Email
        const q = query(collection(db, "students"), where("email", "==", user.email));
        const querySnap = await getDocs(q);

        if (!querySnap.empty) {
            const preRegDoc = querySnap.docs[0];
            const preRegData = preRegDoc.data();
            
            // Link UID
            await setDoc(userRef, {
                ...preRegData,
                uid: user.uid,
                name: user.displayName,
                photo: user.photoURL,
                role: preRegData.role || 'student',
                approved: true
            });
            
            // Clean old doc if needed
            if(preRegDoc.id !== user.uid) await deleteDoc(doc(db, "students", preRegDoc.id));

            currentUser = { ...preRegData, uid: user.uid, name: user.displayName, photo: user.photoURL };
            initDashboard();
        } else {
            // Not registered
            alert("⛔ Access Denied!\n\nEmail: " + user.email + "\nReason: Not registered by Admin.");
            await signOut(auth);
            showLoginScreen();
            if(loginBtn) {
                loginBtn.disabled = false;
                loginBtn.innerHTML = "Login with Registered Gmail";
            }
        }
    } catch(err) {
        alert("DB Error: " + err.message);
    }
}

// --- UI HELPERS ---
function showLoginScreen() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
}

function initDashboard() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('dashboard-section').classList.remove('hidden');
    
    // Fill Profile
    if(document.getElementById('nav-photo')) document.getElementById('nav-photo').src = currentUser.photo;
    if(document.getElementById('profile-photo')) document.getElementById('profile-photo').src = currentUser.photo;
    if(document.getElementById('profile-name')) document.getElementById('profile-name').innerText = currentUser.name;
    if(document.getElementById('profile-email')) document.getElementById('profile-email').innerText = currentUser.email;
    if(document.getElementById('header-name')) document.getElementById('header-name').innerText = currentUser.name.split(' ')[0];
    if(document.getElementById('header-role')) document.getElementById('header-role').innerText = currentUser.role.toUpperCase();
    if(document.getElementById('profile-role')) document.getElementById('profile-role').innerText = currentUser.role.toUpperCase();

    // Show Admin UI
    if (currentUser.role === 'admin') {
        if(document.getElementById('tab-admin')) document.getElementById('tab-admin').classList.remove('hidden');
        if(document.getElementById('admin-upload-ui')) document.getElementById('admin-upload-ui').classList.remove('hidden');
        if(document.getElementById('admin-exam-ui')) document.getElementById('admin-exam-ui').classList.remove('hidden');
        if(document.getElementById('edit-announce-btn')) document.getElementById('edit-announce-btn').classList.remove('hidden');
        loadAllUsers();
    } else {
        if(document.getElementById('student-score-card')) document.getElementById('student-score-card').classList.remove('hidden');
        loadMyResults();
    }
    
    loadAnnouncement();
    loadNotes();
    loadExams();
    loadLeaderboard();
}

// --- ADMIN: REGISTER STUDENT ---
window.registerStudent = async () => {
    const email = document.getElementById('new-student-email').value.trim();
    if(!email) return showToast("Enter email", "error");
    const q = query(collection(db, "students"), where("email", "==", email));
    const snap = await getDocs(q);
    if(!snap.empty) return showToast("Already exists", "error");
    
    await addDoc(collection(db, "students"), { email, name: "New Student", role: "student", approved: true, photo: "https://cdn-icons-png.flaticon.com/512/149/149071.png" });
    showToast("Student Registered!", "success");
    document.getElementById('new-student-email').value = "";
    loadAllUsers();
};

async function loadAllUsers() {
    const snaps = await getDocs(collection(db, "students"));
    const list = document.getElementById('users-list'); list.innerHTML = "";
    let pending = 0;
    if(document.getElementById('admin-stat-users')) document.getElementById('admin-stat-users').innerText = snaps.size;
    snaps.forEach(doc => {
        const u = doc.data();
        if(!u.approved) pending++;
        list.innerHTML += `
        <div class="p-2 flex justify-between items-center border-b border-slate-50 last:border-0">
            <div class="flex items-center gap-2">
                <img src="${u.photo}" class="w-6 h-6 rounded-full bg-slate-100">
                <div class="overflow-hidden"><div class="font-bold text-xs text-slate-700 truncate w-24">${u.name}</div><div class="text-[10px] text-slate-400 truncate w-24">${u.email}</div></div>
            </div>
            ${u.role!=='admin'?`<button onclick="deleteItem('students','${doc.id}')" class="text-red-400 text-[10px]"><i class="fas fa-trash"></i></button>`:`<span class="text-[9px] text-blue-600 font-bold">Admin</span>`}
        </div>`;
    });
    if(document.getElementById('admin-stat-pending')) document.getElementById('admin-stat-pending').innerText = pending;
}

window.deleteItem = async (col, id) => { if(confirm("Delete this?")) { await deleteDoc(doc(db, col, id)); loadAllUsers(); loadNotes(); loadExams(); } };

// --- NOTES ---
document.getElementById('upload-btn')?.addEventListener('click', async () => {
    const fileInput = document.getElementById('note-file');
    const title = document.getElementById('note-title').value;
    const btn = document.getElementById('upload-btn');
    const CLOUD_NAME = "dpe74ejhl"; 
    const UPLOAD_PRESET = "lms_upload"; 
    if(fileInput.files.length === 0 || !title) return showToast("Missing fields", 'error');
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('upload_preset', UPLOAD_PRESET);
    btn.disabled = true; btn.innerText = "Uploading...";
    try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if(data.error) throw new Error(data.error.message);
        let type = data.format === 'pdf' || fileInput.files[0].name.endsWith('.pdf') ? 'pdf' : 'image';
        await addDoc(collection(db, "notes"), { title, url: data.secure_url, type, createdAt: serverTimestamp() });
        showToast("Uploaded!", 'success');
        fileInput.value = ""; document.getElementById('note-title').value = ""; loadNotes();
    } catch(e) { showToast(e.message, 'error'); }
    btn.disabled = false; btn.innerText = "Upload";
});

async function loadNotes() {
    const snaps = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
    allNotes = []; snaps.forEach(doc => allNotes.push(doc.data()));
    renderNotes(allNotes);
}

function renderNotes(notes) {
    const list = document.getElementById('notes-list'); list.innerHTML = "";
    if(notes.length === 0) list.innerHTML = `<div class="text-center py-6 text-slate-300 text-xs w-full col-span-3">No notes found</div>`;
    notes.forEach(n => {
        const icon = n.type === 'pdf' ? 'fa-file-pdf text-red-500' : 'fa-file-image text-blue-500';
        list.innerHTML += `
        <div onclick="openViewer('${n.url}', '${n.type}')" class="bg-white p-3 rounded-xl border border-slate-100 flex items-center gap-3 active:scale-[0.98] transition cursor-pointer shadow-sm hover:shadow-md">
            <div class="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center"><i class="fas ${icon} text-lg"></i></div>
            <div class="flex-grow overflow-hidden"><h4 class="font-bold text-slate-700 text-xs truncate">${n.title}</h4><span class="text-[10px] text-slate-400 uppercase">${n.type}</span></div>
        </div>`;
    });
}

// --- EXAMS ---
window.openExamCreator = () => document.getElementById('exam-creator-modal').classList.remove('hidden');
window.closeExamCreator = () => document.getElementById('exam-creator-modal').classList.add('hidden');
window.addQuestionField = () => {
    const c = document.getElementById('questions-container');
    const div = document.createElement('div');
    div.className = "bg-white p-3 rounded-lg border border-slate-200 q-block relative animate-fade-in";
    div.innerHTML = `
        <div class="absolute right-2 top-2 text-[10px] font-bold text-slate-300">Q${c.children.length+1}</div>
        <input class="w-full border-b border-slate-100 p-2 mb-2 font-bold text-sm q-text outline-none" placeholder="Question...">
        <div class="grid gap-2 mb-2">${[1,2,3,4].map(i => `<input class="bg-slate-50 border-none p-2 rounded text-xs q-opt${i}" placeholder="Opt ${i}">`).join('')}</div>
        <select class="w-full bg-blue-50 text-blue-600 p-2 rounded text-xs font-bold q-correct border-none"><option value="1">Ans: 1</option><option value="2">Ans: 2</option><option value="3">Ans: 3</option><option value="4">Ans: 4</option></select>`;
    c.appendChild(div);
};
window.publishExam = async () => {
    const title = document.getElementById('new-exam-title').value;
    const dur = document.getElementById('new-exam-duration').value;
    const qBlocks = document.querySelectorAll('.q-block');
    if(!title || !dur || qBlocks.length===0) return showToast("Incomplete", 'error');
    const questions = [];
    qBlocks.forEach(b => questions.push({ text: b.querySelector('.q-text').value, options: [b.querySelector('.q-opt1').value, b.querySelector('.q-opt2').value, b.querySelector('.q-opt3').value, b.querySelector('.q-opt4').value], correct: parseInt(b.querySelector('.q-correct').value)-1 }));
    await addDoc(collection(db, "exams"), { title, duration: parseInt(dur), questions, createdAt: serverTimestamp() });
    closeExamCreator(); loadExams(); showToast("Published!", 'success');
};
async function loadExams() {
    const snaps = await getDocs(query(collection(db, "exams"), orderBy("createdAt", "desc")));
    allExams = []; snaps.forEach(doc => allExams.push({id: doc.id, ...doc.data()}));
    const resSnaps = await getDocs(query(collection(db, "results"), where("studentId", "==", currentUser.uid)));
    const takenIds = []; resSnaps.forEach(doc => takenIds.push(doc.data().examId));
    const list = document.getElementById('exams-list'); list.innerHTML = "";
    if(allExams.length === 0) list.innerHTML = `<div class="text-center py-6 text-slate-300 text-xs w-full col-span-3">No exams</div>`;
    allExams.forEach(e => {
        const isTaken = takenIds.includes(e.id);
        list.innerHTML += `
        <div class="bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg flex items-center justify-center ${isTaken?'bg-green-100 text-green-600':'bg-indigo-100 text-indigo-600'}"><i class="fas ${isTaken?'fa-check':'fa-pen'}"></i></div>
                <div><h3 class="font-bold text-slate-700 text-xs truncate w-24">${e.title}</h3><p class="text-[10px] text-slate-400">${e.duration}m • ${e.questions.length}Q</p></div>
            </div>
            ${!isTaken?`<button onclick="startExam('${e.id}')" class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">Start</button>`:`<span class="text-[10px] font-bold text-green-500">Done</span>`}
        </div>`;
    });
}
window.startExam = async (eid) => {
    const docSnap = await getDoc(doc(db, "exams", eid)); currentExam = {id: docSnap.id, ...docSnap.data()};
    document.getElementById('exam-taker-modal').classList.remove('hidden');
    document.getElementById('taking-exam-title').innerText = currentExam.title;
    const area = document.getElementById('exam-questions-area'); area.innerHTML = "";
    currentExam.questions.forEach((q, idx) => {
        area.innerHTML += `<div class="bg-white p-4 rounded-xl shadow-sm mb-4"><p class="font-bold text-sm mb-2 text-slate-800">Q${idx+1}. ${q.text}</p><div class="space-y-2">${q.options.map((opt, i) => `<label class="flex items-center gap-2 bg-slate-50 p-3 rounded-lg cursor-pointer"><input type="radio" name="q-${idx}" value="${i}"> <span class="text-xs text-slate-600">${opt}</span></label>`).join('')}</div></div>`;
    });
    let time = currentExam.duration * 60; const disp = document.getElementById('timer-display');
    examTimer = setInterval(() => { time--; const m = Math.floor(time/60); const s = time%60; disp.innerText = `${m}:${s<10?'0'+s:s}`; if(time <= 0) submitExam(); }, 1000);
};
window.submitExam = async () => {
    clearInterval(examTimer); let score=0; currentExam.questions.forEach((q, idx) => { const sel = document.querySelector(`input[name="q-${idx}"]:checked`); if(sel && parseInt(sel.value)===q.correct) score++; });
    await addDoc(collection(db, "results"), { examId: currentExam.id, examTitle: currentExam.title, studentId: currentUser.uid, studentName: currentUser.name, score, total: currentExam.questions.length, submittedAt: serverTimestamp() });
    document.getElementById('exam-taker-modal').classList.add('hidden'); showToast(`Score: ${score}`, 'success'); loadExams(); loadMyResults(); loadLeaderboard();
};

// --- MISC & GLOBAL ---
window.switchTab = (tab) => {
    ['notes', 'exams', 'leaderboard', 'admin'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`); const view = document.getElementById(`view-${t}`);
        if(btn && view) { view.classList.toggle('hidden', t!==tab); btn.className = t===tab ? "flex-1 min-w-[80px] py-2.5 text-xs font-bold rounded-lg bg-white shadow text-blue-600 transition" : "flex-1 min-w-[80px] py-2.5 text-xs font-medium rounded-lg text-slate-400 hover:bg-slate-50 transition"; }
    });
};
async function loadMyResults() {
    const list = document.getElementById('my-results-list'); list.innerHTML = "";
    const snaps = await getDocs(query(collection(db, "results"), where("studentId", "==", currentUser.uid), orderBy("submittedAt", "desc")));
    snaps.forEach(doc => { const r = doc.data(); list.innerHTML += `<div class="flex justify-between bg-slate-50 p-2 rounded-lg text-xs"><span class="font-bold text-slate-600 truncate w-24">${r.examTitle}</span><span class="font-bold text-green-600">${r.score}/${r.total}</span></div>`; });
}
async function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list'); list.innerHTML = "";
    const snaps = await getDocs(query(collection(db, "results"), orderBy("score", "desc"), limit(10)));
    let rank=1; snaps.forEach(doc => { const r = doc.data(); list.innerHTML += `<div class="p-3 flex justify-between items-center"><div class="flex items-center gap-3"><span class="font-bold text-slate-400 w-4">${rank++}</span><div><div class="font-bold text-xs text-slate-700">${r.studentName}</div><div class="text-[10px] text-slate-400 truncate w-24">${r.examTitle}</div></div></div><span class="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">${r.score}/${r.total}</span></div>`; });
}
async function loadAnnouncement() { const snap = await getDoc(doc(db, "settings", "announcement")); if(snap.exists() && snap.data().text) { document.getElementById('announcement-area').classList.remove('hidden'); document.getElementById('announcement-text').innerText = snap.data().text; } }
window.postAnnouncement = async () => { const text = prompt("Announcement:"); if(text) { await setDoc(doc(db, "settings", "announcement"), { text }); loadAnnouncement(); } };
window.openProfileModal = () => document.getElementById('profile-modal').classList.remove('hidden');
window.openViewer = (url, type) => { document.getElementById('viewer-modal').classList.remove('hidden'); const wm = document.getElementById('watermark-overlay'); wm.innerHTML = ""; for(let i=0;i<30;i++) wm.innerHTML += `<div class="watermark-text">${currentUser.email}</div>`; const pdf = document.getElementById('pdf-frame'); const img = document.getElementById('image-frame'); if(type === 'pdf') { pdf.src = url; pdf.classList.remove('hidden'); img.classList.add('hidden'); } else { img.src = url; img.classList.remove('hidden'); pdf.classList.add('hidden'); } };
window.closeViewer = () => { document.getElementById('viewer-modal').classList.add('hidden'); document.getElementById('pdf-frame').src = ""; };
document.getElementById('logout-btn')?.addEventListener('click', () => signOut(auth).then(() => location.reload()));
document.getElementById('global-search').addEventListener('input', (e) => { const term = e.target.value.toLowerCase(); renderNotes(allNotes.filter(n => n.title.toLowerCase().includes(term))); });