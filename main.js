/* =====================================================================
   MASUSPACE POS - main.js
   PART 3 dari 6: inti (konstanta, helper, login, sesi, navigasi, dashboard)
   Jangan di-upload sendiri. Part 6 akan menutup file dan semua part digabung.
   ===================================================================== */
(function () {
    const SUPABASE_URL = 'https://lgyrypbzaspysibssttm.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxneXJ5cGJ6YXNweXNpYnNzdHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NDM4MzIsImV4cCI6MjEwNzIxOTgzMn0.lUPnYTvG8KjxQe2-e2FAhuDXbh6XA2g31Vc2_JWObN4';
    // ISI dengan email user Owner di Supabase (Authentication > Users)
    const OWNER_AUTH_EMAIL = 'ISI-EMAIL-OWNER-DI-SINI';

    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    document.addEventListener('submit', function (e) { e.preventDefault(); return false; });

    const OWNER_ONLY_PAGES = ['cash', 'reports', 'settings'];
    let state = {
        currentUser: null, authUserId: null, currentPage: 'dashboard',
        cart: [], categories: [], products: [], variants: [], addons: [],
        modalProduct: null, modalVariant: { suhu: 'Hot', ukuran: 'Regular' }, modalAddons: [], modalQty: 1,
        paymentMethod: 'cash', cashReceived: 0, discount: { type: 'percent', value: 0 },
        orderType: 'dine_in', currentReceipt: null, kasirExpenses: [], pendingPhotoBase64: null
    };
    let dashboardRequestId = 0, dashboardFilterTimer;
    let orderRequestId = 0, orderFilterTimer;
    let reportRequestId = 0, reportFilterTimer;
    let toastTimer;

    /* ---------- Helper ---------- */
    function formatRp(num) { return 'Rp ' + Math.round(Number(num) || 0).toLocaleString('id-ID'); }
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function getJakartaDateParts(date = new Date()) {
        return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    }
    function getTodayJakarta() { const { year, month, day } = getJakartaDateParts(); return `${year}-${month}-${day}`; }
    function getJakartaMonthStart() { const { year, month } = getJakartaDateParts(); return `${year}-${month}-01`; }
    function getJakartaDateDaysAgo(days) {
        const { year, month, day } = getJakartaDateParts();
        return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) - days)).toISOString().slice(0, 10);
    }
    function getJakartaDate() { return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }).format(new Date()); }
    function dayStartISO(dateStr) { return dateStr + 'T00:00:00+07:00'; }
    function dayEndExclusiveISO(dateStr) { return new Date(new Date(dateStr + 'T00:00:00+07:00').getTime() + 86400000).toISOString(); }
    function showToast(msg, err = false) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.className = 'toast show' + (err ? ' error' : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.className = 'toast'; }, 3000);
    }
    function setAvatar(el, user) {
        if (!el) return;
        const url = user?.avatar_url;
        if (url && (url.startsWith('http') || url.startsWith('data:image'))) el.innerHTML = `<img src="${escapeHtml(url)}" alt="" style="width:100%;height:100%;object-fit:cover">`;
        else el.innerText = (user?.full_name || '?').charAt(0).toUpperCase();
    }

    /* ---------- Login ---------- */
    async function loadUsersToDropdown() {
        try {
            const { data } = await supabase.from('app_users').select('username, full_name, role').eq('is_active', true).order('full_name');
            const select = document.getElementById('loginUsername');
            if (!select) return;
            select.innerHTML = '<option value="">— pilih user —</option>';
            (data || []).forEach(user => {
                const option = document.createElement('option');
                option.value = user.username;
                option.dataset.role = user.role;
                option.textContent = `${user.full_name} (${user.role})`;
                select.appendChild(option);
            });
        } catch (e) { console.error(e); }
    }

    window.togglePassword = function () {
        const input = document.getElementById('loginPassword');
        const icon = document.getElementById('passwordIcon');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        icon.classList.toggle('fa-eye', !show);
        icon.classList.toggle('fa-eye-slash', show);
    };

    async function activateUser(user, authUserId = null) {
        state.currentUser = user;
        state.authUserId = authUserId;
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        document.body.classList.toggle('role-kasir', user.role === 'kasir');
        const roleLabel = user.role === 'owner' ? 'Administrator' : 'Kasir';
        ['userName', 'userName2'].forEach(id => { document.getElementById(id).innerText = user.full_name; });
        ['userRole', 'userRole2'].forEach(id => { document.getElementById(id).innerText = roleLabel; });
        setAvatar(document.getElementById('userAvatar'), user);
        setAvatar(document.getElementById('userAvatar2'), user);
        document.querySelectorAll('.nav-item[data-page]').forEach(button => {
            button.style.display = button.classList.contains('owner-only') && user.role === 'kasir' ? 'none' : 'flex';
        });
        await window.navigate('dashboard');
    }

    window.handleLogin = async function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const select = document.getElementById('loginUsername');
        const username = select.value.trim();
        const isOwner = select.selectedOptions[0]?.dataset.role === 'owner';
        const password = document.getElementById('loginPassword').value;
        const btn = document.getElementById('loginBtn');
        const originalText = btn.innerHTML;
        if (!username || !password) { showToast('Pilih pengguna dan isi password!', true); return false; }
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
        btn.disabled = true;
        try {
            if (isOwner) {
                const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: OWNER_AUTH_EMAIL, password });
                if (authError || !authData?.user) throw new Error('Password Owner salah.');
                const { data: owner, error: ownerError } = await supabase.from('app_users')
                    .select('id, username, full_name, role, is_active, avatar_url, auth_user_id')
                    .eq('auth_user_id', authData.user.id).eq('role', 'owner').eq('is_active', true).maybeSingle();
                if (ownerError || !owner) {
                    await supabase.auth.signOut();
                    throw new Error('Akun Auth ini belum terhubung ke Owner MasuSpace (cek kolom auth_user_id).');
                }
                await activateUser(owner, authData.user.id);
            } else {
                await supabase.auth.signOut();
                const { data: cashier, error } = await supabase.from('app_users')
                    .select('id, username, full_name, role, is_active, avatar_url')
                    .eq('username', username).eq('password_hash', password).eq('is_active', true).single();
                if (error || !cashier || cashier.role !== 'kasir') throw new Error('Password kasir salah.');
                await activateUser(cashier);
            }
        } catch (error) {
            showToast(error.message || 'Gagal masuk.', true);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
        return false;
    };

    window.restoreOwnerSession = async function () {
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const authUserId = sessionData?.session?.user?.id;
            if (!authUserId) return;
            const { data: owner } = await supabase.from('app_users')
                .select('id, username, full_name, role, is_active, avatar_url, auth_user_id')
                .eq('auth_user_id', authUserId).eq('role', 'owner').eq('is_active', true).maybeSingle();
            if (owner) await activateUser(owner, authUserId);
            else await supabase.auth.signOut();
        } catch (error) { console.error('Gagal memulihkan sesi Owner:', error); }
    };

    window.logout = async function () {
        if (state.cart.length) window.saveCurrentHeldOrder();
        if (state.authUserId) await supabase.auth.signOut();
        state.currentUser = null;
        state.authUserId = null;
        state.cart = [];
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('loginPage').style.display = 'flex';
        document.getElementById('loginPassword').value = '';
        document.body.classList.remove('role-kasir');
        window.closeUserMenu();
    };

    window.toggleUserMenu = function () { document.getElementById('userDropdown').classList.toggle('show'); };
    window.closeUserMenu = function () { document.getElementById('userDropdown').classList.remove('show'); };
    document.addEventListener('click', function (e) {
        const userMenu = document.querySelector('.user-menu');
        if (userMenu && !userMenu.contains(e.target)) window.closeUserMenu();
    });

    /* ---------- Navigasi ---------- */
    const PAGE_TITLES = { dashboard: 'Dashboard', kasir: 'Kasir POS', orders: 'Riwayat Order', cash: 'Kas & Bank', reports: 'Laporan', settings: 'Pengaturan' };
    window.navigate = async function (page) {
        if (!PAGE_TITLES[page]) return false;
        if (state.currentUser?.role === 'kasir' && OWNER_ONLY_PAGES.includes(page)) { showToast('Halaman ini khusus Owner.', true); return false; }
        state.currentPage = page;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(`page-${page}`)?.classList.add('active');
        document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.toggle('active', n.dataset.page === page));
        document.getElementById('pageTitle').innerText = PAGE_TITLES[page];
        const loaders = { dashboard: loadDashboard, kasir: loadKasirData, orders: loadOrders, cash: loadCash, reports: loadReports, settings: loadSettings };
        try { await loaders[page](); } catch (error) { console.error(error); showToast('Gagal memuat halaman: ' + error.message, true); }
        if (window.innerWidth <= 1024) document.getElementById('sidebar').classList.add('collapsed');
        window.closeUserMenu();
    };
    window.toggleSidebar = function () { document.getElementById('sidebar').classList.toggle('collapsed'); };

    function updateClock() {
        const now = new Date();
        const clockEl = document.getElementById('liveClock');
        const dateEl = document.getElementById('headerDate');
        if (clockEl) clockEl.innerText = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }) + ' WIB';
        if (dateEl) dateEl.innerText = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
    }
    setInterval(updateClock, 1000); updateClock();

    /* ---------- Dashboard ---------- */
    async function loadDashboard() {
        const requestId = ++dashboardRequestId;
        const today = getTodayJakarta();
        const startInput = document.getElementById('dashboardStartDate');
        const endInput = document.getElementById('dashboardEndDate');
        if (startInput && !startInput.value) startInput.value = today;
        if (endInput && !endInput.value) endInput.value = today;
        const startDate = startInput?.value || today;
        const endDate = endInput?.value || today;
        if (startDate > endDate) { showToast('Tanggal awal tidak boleh melewati tanggal akhir.', true); return; }
        const rangeStart = dayStartISO(startDate);
        const rangeEnd = dayEndExclusiveISO(endDate);
        try {
            const [ordersResult, expensesResult, inventoryResult] = await Promise.all([
                supabase.from('orders').select('id,total,payment_method').gte('created_at', rangeStart).lt('created_at', rangeEnd).in('status', ['paid', 'completed']),
                supabase.from('expenses').select('amount,cash_sources(name)').gte('created_at', rangeStart).lt('created_at', rangeEnd),
                supabase.rpc('get_inventory_summary')
            ]);
            if (requestId !== dashboardRequestId) return;
            if (ordersResult.error) throw ordersResult.error;
            if (expensesResult.error) throw expensesResult.error;
            const orders = ordersResult.data || [];
            const expenses = expensesResult.data || [];
            let productItems = [];
            if (orders.length) {
                const { data, error } = await supabase.from('order_items').select('order_id,qty,products(name)').in('order_id', orders.map(o => o.id));
                if (error) throw error;
                productItems = data || [];
            }
            if (requestId !== dashboardRequestId) return;
            const totalRevenue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
            const totalExpense = expenses.reduce((s, x) => s + Number(x.amount || 0), 0);
            const netProfit = totalRevenue - totalExpense;
            const pay = { cash: 0, qris: 0, debit: 0 };
            orders.forEach(o => { if (pay[o.payment_method] !== undefined) pay[o.payment_method] += Number(o.total || 0); });
            const cashierExpenses = expenses.filter(x => x.cash_sources?.name === 'Cash Kasir').reduce((s, x) => s + Number(x.amount || 0), 0);
            const lowStock = inventoryResult.error ? 0 : (Number(inventoryResult.data?.low_stock || 0) + Number(inventoryResult.data?.out_of_stock || 0));

            document.getElementById('statOrders').innerText = orders.length;
            document.getElementById('statRevenue').innerText = formatRp(totalRevenue);
            document.getElementById('statExpense').innerText = formatRp(totalExpense);
            document.getElementById('statProfit').innerText = formatRp(netProfit);
            document.getElementById('statProfit').style.color = netProfit >= 0 ? 'var(--primary-dark)' : '#ef4444';
            document.getElementById('statCash').innerText = formatRp(pay.cash - cashierExpenses);
            document.getElementById('statLowStock').innerText = lowStock;
            const isToday = startDate === today && endDate === today;
            document.getElementById('dashboardPaymentTitle').innerText = isToday ? 'Pembayaran Hari Ini' : 'Pembayaran Periode';

            const row = (icon, label, val, last) => `<div style="display:flex;justify-content:space-between;padding:10px 0;${last ? '' : 'border-bottom:1px solid var(--border)'}"><span><i class="fas ${icon}" style="color:var(--primary);margin-right:8px"></i>${label}</span><b>${formatRp(val)}</b></div>`;
            document.getElementById('dashPaymentMethods').innerHTML = row('fa-money-bill-wave', 'Cash', pay.cash) + row('fa-qrcode', 'QRIS', pay.qris) + row('fa-credit-card', 'Debit', pay.debit, true);

            const best = new Map();
            productItems.forEach(i => { const n = i.products?.name || 'Produk'; best.set(n, (best.get(n) || 0) + Number(i.qty || 0)); });
            const top = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
            document.getElementById('dashTopProducts').innerHTML = top.length
                ? top.map(([name, qty], idx) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)"><span>${idx + 1}. ${escapeHtml(name)}</span><b>${qty} terjual</b></div>`).join('')
                : '<p style="color:var(--text-light);text-align:center;padding:20px">Belum ada penjualan pada periode ini</p>';
        } catch (error) { console.error(error); showToast('Gagal memuat dashboard: ' + error.message, true); }
    }
    window.loadDashboard = loadDashboard;
    window.applyDashboardFilter = function () { clearTimeout(dashboardFilterTimer); dashboardFilterTimer = setTimeout(loadDashboard, 180); };
    window.resetDashboardFilter = function () {
        clearTimeout(dashboardFilterTimer);
        const today = getTodayJakarta();
        document.getElementById('dashboardStartDate').value = today;
        document.getElementById('dashboardEndDate').value = today;
        loadDashboard();
    };

/* ===== AKHIR PART 3 ===== */
/* =====================================================================
   PART 4 dari 6: kasir (menu, pengeluaran cepat, keranjang, diskon,
   pembayaran, struk, draft order)
   ===================================================================== */

    /* ---------- Data kasir ---------- */
    async function loadKasirData() {
        if (state.categories.length === 0) {
            const [cats, prods, vars, adds] = await Promise.all([
                supabase.from('categories').select('*').eq('is_active', true).order('display_order'),
                supabase.from('products').select('*').eq('is_active', true).order('display_order'),
                supabase.from('product_variants').select('*').eq('is_active', true),
                supabase.from('addons').select('*').eq('is_active', true).order('display_order')
            ]);
            state.categories = cats.data || [];
            state.products = prods.data || [];
            state.variants = vars.data || [];
            state.addons = adds.data || [];
        }
        renderCategories();
        renderProducts();
        await Promise.all([loadQuickExpenseSources(), loadKasirExpenses()]);
    }

    async function loadQuickExpenseSources() {
        const { data, error } = await supabase.rpc('get_cash_sources');
        const select = document.getElementById('quickExpenseSource');
        if (!select) return;
        if (error) { console.error(error); select.innerHTML = '<option value="">Sumber kas tidak tersedia</option>'; return; }
        select.innerHTML = '<option value="">Sumber Kas</option>' + (data || []).map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    }

    async function loadKasirExpenses() {
        const today = getTodayJakarta();
        const { data } = await supabase.from('expenses').select('*, cash_sources(name)')
            .gte('created_at', dayStartISO(today)).lt('created_at', dayEndExclusiveISO(today)).order('created_at', { ascending: false });
        state.kasirExpenses = data || [];
        const badge = document.getElementById('expenseCountBadge');
        if (badge) badge.innerText = state.kasirExpenses.length;
    }

    /* ---------- Pengeluaran kasir ---------- */
    window.showExpenseHistoryModal = function () {
        const content = document.getElementById('expenseHistoryContent');
        if (!state.kasirExpenses.length) {
            content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light)"><i class="fas fa-receipt" style="font-size:48px;margin-bottom:12px;opacity:.3"></i><p>Belum ada pengeluaran hari ini</p></div>';
        } else {
            let total = 0;
            content.innerHTML = state.kasirExpenses.map(e => {
                total += Number(e.amount || 0);
                return `<div class="expense-history-modal-item"><div class="exp-info"><div class="exp-cat">${escapeHtml(e.category)}</div><div class="exp-desc">${escapeHtml(e.description || '-')}</div><div class="exp-time">${new Date(e.created_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} • ${escapeHtml(e.cash_sources?.name || '-')}</div></div><div class="exp-amount">-${formatRp(e.amount)}</div><div class="exp-actions"><button onclick="window.editExpense('${e.id}')" title="Edit"><i class="fas fa-edit"></i></button><button class="delete-exp-btn" onclick="window.deleteExpense('${e.id}')" title="Hapus"><i class="fas fa-trash"></i></button></div></div>`;
            }).join('') + `<div style="margin-top:16px;padding:12px;background:var(--primary-light);border-radius:8px;display:flex;justify-content:space-between;font-weight:700"><span>Total Pengeluaran Hari Ini</span><span style="color:var(--primary-dark)">${formatRp(total)}</span></div>`;
        }
        document.getElementById('expenseHistoryModal').classList.add('active');
    };
    window.editExpense = function (id) {
        const e = state.kasirExpenses.find(x => x.id === id);
        if (!e) return;
        document.getElementById('editExpenseId').value = id;
        document.getElementById('editExpenseCategory').value = e.category;
        document.getElementById('editExpenseAmount').value = e.amount;
        document.getElementById('editExpenseModal').classList.add('active');
    };
    window.saveEditedExpense = async function () {
        const id = document.getElementById('editExpenseId').value;
        const category = document.getElementById('editExpenseCategory').value.trim();
        const amount = parseFloat(document.getElementById('editExpenseAmount').value) || 0;
        if (!category || amount <= 0) { showToast('Lengkapi data!', true); return; }
        const { data, error } = await supabase.rpc('update_expense', { p_expense_id: id, p_amount: amount, p_category: category, p_description: category });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Pengeluaran diupdate!');
        window.closeModal('editExpenseModal');
        await loadKasirExpenses();
        window.showExpenseHistoryModal();
    };
    window.deleteExpense = async function (id) {
        if (!confirm('Hapus pengeluaran ini? Saldo akan dikembalikan.')) return;
        const { data, error } = await supabase.rpc('delete_expense', { p_expense_id: id });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Pengeluaran dihapus!');
        await loadKasirExpenses();
        window.showExpenseHistoryModal();
    };
    window.quickExpense = async function () {
        const source = document.getElementById('quickExpenseSource').value;
        const amount = parseFloat(document.getElementById('quickExpenseAmount').value) || 0;
        const desc = document.getElementById('quickExpenseDesc').value.trim();
        if (!source) { showToast('Pilih sumber kas!', true); return; }
        if (amount <= 0) { showToast('Jumlah wajib!', true); return; }
        if (!desc) { showToast('Keterangan wajib!', true); return; }
        const { data, error } = await supabase.rpc('add_expense', { p_source_id: source, p_amount: amount, p_category: desc, p_description: desc, p_created_by: state.currentUser?.id || null });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Pengeluaran dicatat!');
        document.getElementById('quickExpenseAmount').value = '';
        document.getElementById('quickExpenseDesc').value = '';
        await loadKasirExpenses();
    };

    /* ---------- Menu ---------- */
    function renderCategories() {
        const active = state.activeCategory || null;
        let h = `<div class="category-card ${active ? '' : 'active'}" onclick="window.selectCat(null, this)"><h4>🍽️ Semua</h4></div>`;
        state.categories.forEach(c => { h += `<div class="category-card ${active === c.id ? 'active' : ''}" onclick="window.selectCat('${c.id}', this)"><h4>${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</h4></div>`; });
        document.getElementById('categoriesContainer').innerHTML = h;
    }
    function renderProducts() {
        let list = state.products;
        if (state.activeCategory) list = list.filter(p => p.category_id === state.activeCategory);
        const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
        if (search) list = list.filter(p => p.name.toLowerCase().includes(search));
        document.getElementById('productsGrid').innerHTML = list.length
            ? list.map(p => `<div class="product-card" onclick="window.openModal('${p.id}')"><div class="product-img"></div><div class="product-name">${escapeHtml(p.name)}</div><div class="product-price">${formatRp(p.base_price)}</div><button class="add-btn"><i class="fas fa-plus"></i></button></div>`).join('')
            : '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-light)">Tidak ada produk</div>';
    }
    window.selectCat = function (id, el) {
        state.activeCategory = id;
        document.querySelectorAll('.category-card').forEach(c => c.classList.remove('active'));
        if (el) el.classList.add('active');
        renderProducts();
    };
    document.getElementById('searchInput')?.addEventListener('input', renderProducts);

    /* ---------- Modal produk ---------- */
    function modalUnitPrice() {
        let price = Number(state.modalProduct.base_price);
        if (state.modalVariant.suhu === 'Iced') price += 2000;
        if (state.modalVariant.ukuran === 'Large') price += 5000;
        state.modalAddons.forEach(id => { const a = state.addons.find(x => x.id === id); if (a) price += Number(a.price); });
        return price;
    }
    window.openModal = function (pid) {
        const p = state.products.find(x => x.id === pid);
        if (!p) return;
        state.modalProduct = p;
        state.modalVariant = { suhu: 'Hot', ukuran: 'Regular' };
        state.modalAddons = [];
        state.modalQty = 1;
        document.getElementById('modalProductName').innerText = p.name;
        document.getElementById('modalNotes').value = '';
        document.getElementById('modalQty').innerText = '1';
        renderVariants(); renderAddons(); updateModalTotal();
        document.getElementById('productModal').classList.add('active');
    };
    function renderVariants() {
        const opt = (type, val, label) => `<div class="variant-option ${state.modalVariant[type] === val ? 'selected' : ''}" onclick="window.selVar('${type}','${val}')">${label}</div>`;
        document.getElementById('suhuVariants').innerHTML = opt('suhu', 'Hot', '☕ Hot') + opt('suhu', 'Iced', '🧊 Iced (+2K)');
        document.getElementById('ukuranVariants').innerHTML = opt('ukuran', 'Regular', 'Regular') + opt('ukuran', 'Large', 'Large (+5K)');
    }
    window.selVar = function (type, val) { state.modalVariant[type] = val; renderVariants(); updateModalTotal(); };
    function renderAddons() {
        document.getElementById('addonsList').innerHTML = state.addons.length
            ? state.addons.map(a => `<div class="addon-item"><label><input type="checkbox" ${state.modalAddons.includes(a.id) ? 'checked' : ''} onchange="window.togAddon('${a.id}')"> ${escapeHtml(a.name)}</label><span style="font-weight:700;color:var(--primary-dark)">+${formatRp(a.price)}</span></div>`).join('')
            : '<p style="font-size:12px;color:var(--text-light)">Tidak ada add-on</p>';
    }
    window.togAddon = function (id) {
        state.modalAddons = state.modalAddons.includes(id) ? state.modalAddons.filter(x => x !== id) : [...state.modalAddons, id];
        updateModalTotal();
    };
    window.changeQty = function (d) {
        state.modalQty = Math.max(1, state.modalQty + d);
        document.getElementById('modalQty').innerText = state.modalQty;
        updateModalTotal();
    };
    function updateModalTotal() { if (state.modalProduct) document.getElementById('modalTotal').innerText = formatRp(modalUnitPrice() * state.modalQty); }

    /* ---------- Keranjang & diskon ---------- */
    function cartSubtotal() { return state.cart.reduce((s, i) => s + i.unit_price * i.qty, 0); }
    // Diskon dibatasi (persen 0-100, nominal tidak melebihi subtotal) dan dibulatkan ke rupiah
    function calcDiscount(sub) {
        const v = Math.max(Number(state.discount.value) || 0, 0);
        const d = state.discount.type === 'percent' ? sub * Math.min(v, 100) / 100 : v;
        return Math.min(Math.round(d), sub);
    }
    function cartTotal() { const sub = cartSubtotal(); return sub - calcDiscount(sub); }

    window.addToCart = function () {
        if (!state.modalProduct) return;
        const unitPrice = modalUnitPrice();
        const addons = state.modalAddons.map(id => { const a = state.addons.find(x => x.id === id); return { id: a.id, name: a.name, price: a.price }; });
        const notes = document.getElementById('modalNotes').value.trim();
        const key = [state.modalProduct.id, state.modalVariant.suhu, state.modalVariant.ukuran, JSON.stringify(addons), notes].join('|');
        const idx = state.cart.findIndex(i => i.key === key);
        if (idx >= 0) state.cart[idx].qty += state.modalQty;
        else state.cart.push({ key, product_id: state.modalProduct.id, name: state.modalProduct.name, unit_price: unitPrice, qty: state.modalQty, variant_suhu: state.modalVariant.suhu, variant_ukuran: state.modalVariant.ukuran, addons, notes });
        window.closeModal('productModal');
        renderCart();
        showToast(`${state.modalProduct.name} ditambahkan!`);
    };
    window.updateQty = function (idx, d) { state.cart[idx].qty += d; if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1); renderCart(); };
    window.removeFromCart = function (idx) { state.cart.splice(idx, 1); renderCart(); };

    function renderCart() {
        const box = document.getElementById('orderList');
        if (!state.cart.length) {
            box.innerHTML = '<div class="empty-order"><i class="fas fa-shopping-basket"></i><p>Belum ada item</p></div>';
        } else {
            box.innerHTML = state.cart.map((item, idx) => `<div class="order-item"><div style="flex:1"><div style="font-weight:700">${escapeHtml(item.name)}</div><div style="font-size:11px;color:var(--text-light)">${escapeHtml(item.variant_suhu)}/${escapeHtml(item.variant_ukuran)} • ${formatRp(item.unit_price)}</div>${item.addons.length ? `<div style="font-size:10px;color:var(--primary)">+ ${item.addons.map(a => escapeHtml(a.name)).join(', ')}</div>` : ''}${item.notes ? `<div style="font-size:10px;color:var(--text-light)">📝 ${escapeHtml(item.notes)}</div>` : ''}<div class="item-qty"><button class="qty-btn" onclick="window.updateQty(${idx},-1)">-</button><span style="font-weight:700;min-width:20px;text-align:center">${item.qty}</span><button class="qty-btn" onclick="window.updateQty(${idx},1)">+</button><button class="qty-btn" onclick="window.removeFromCart(${idx})" style="color:#ef4444;border-color:#ef4444"><i class="fas fa-trash"></i></button></div></div><div style="font-weight:800;font-size:14px">${formatRp(item.unit_price * item.qty)}</div></div>`).join('');
        }
        updateTotals();
    }
    function updateTotals() {
        const sub = cartSubtotal();
        const disc = calcDiscount(sub);
        const total = sub - disc;
        document.getElementById('subtotal').innerText = formatRp(sub);
        document.getElementById('total').innerText = formatRp(total);
        document.getElementById('btnTotal').innerText = formatRp(total);
        document.getElementById('placeOrderBtn').disabled = state.cart.length === 0;
        document.getElementById('discountRow').style.display = disc > 0 ? 'flex' : 'none';
        document.getElementById('discountAmount').innerText = '- ' + formatRp(disc);
    }
    window.applyInlineDiscount = function () {
        const type = document.getElementById('discountTypeInline').value;
        const value = parseFloat(document.getElementById('discountValueInline').value) || 0;
        state.discount = type === 'none' ? { type: 'percent', value: 0 } : { type, value };
        updateTotals();
    };
    function resetDiscountUI() {
        state.discount = { type: 'percent', value: 0 };
        document.getElementById('discountTypeInline').value = 'none';
        document.getElementById('discountValueInline').value = '';
    }
    window.setOrderType = function (type, btn) {
        state.orderType = type;
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    };

    /* ---------- Pembayaran ---------- */
    window.showPaymentModal = function () {
        if (!state.cart.length) return;
        document.getElementById('paymentTotal').innerText = formatRp(cartTotal());
        document.getElementById('cashReceived').value = '';
        document.getElementById('changeAmount').innerText = formatRp(0);
        state.cashReceived = 0;
        state.paymentMethod = 'cash';
        document.querySelectorAll('.method-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
        document.getElementById('cashInputSection').style.display = 'block';
        document.getElementById('paymentModal').classList.add('active');
    };
    window.selectPaymentMethod = function (method, btn) {
        state.paymentMethod = method;
        document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('cashInputSection').style.display = method === 'cash' ? 'block' : 'none';
    };
    window.calculateChange = function () {
        state.cashReceived = parseFloat(document.getElementById('cashReceived').value) || 0;
        document.getElementById('changeAmount').innerText = formatRp(Math.max(0, state.cashReceived - cartTotal()));
    };
    window.setQuickCash = function (amount) { document.getElementById('cashReceived').value = amount; window.calculateChange(); };
    window.setExactCash = function () { document.getElementById('cashReceived').value = cartTotal(); window.calculateChange(); };

    window.processPayment = async function () {
        if (!state.cart.length) return;
        const sub = cartSubtotal();
        const discAmt = calcDiscount(sub);
        const total = sub - discAmt;
        if (state.paymentMethod === 'cash' && state.cashReceived < total) { showToast('Uang tidak cukup!', true); return; }
        const btn = document.querySelector('.confirm-payment-btn');
        btn.innerText = 'Memproses...';
        btn.disabled = true;
        try {
            const paid = state.paymentMethod === 'cash' ? state.cashReceived : total;
            const { data, error } = await supabase.rpc('checkout_order', {
                p_cashier_id: state.currentUser?.id || null,
                p_customer_name: document.getElementById('customerName').value.trim() || 'Walk-in',
                p_table_number: document.getElementById('tableNumber').value.trim(),
                p_order_type: state.orderType,
                p_items: state.cart.map(i => ({
                    product_id: i.product_id, variant_id: null, qty: i.qty, unit_price: i.unit_price, addons: i.addons,
                    notes: [i.variant_suhu + '/' + i.variant_ukuran, i.notes].filter(Boolean).join(' • ')
                })),
                // diskon selalu dikirim sebagai nominal agar angka browser = server
                p_discount_amount: discAmt, p_discount_percent: 0, p_tax_amount: 0,
                p_payment_method: state.paymentMethod, p_paid_amount: paid, p_notes: ''
            });
            if (error) throw error;
            showToast(`✅ Order ${data.order_number} berhasil!`);
            state.currentReceipt = { ...data, items: [...state.cart], subtotal: sub, total: data.total ?? total, payment_method: state.paymentMethod, cash_received: paid, change: Math.max(0, paid - total), discount: discAmt };
            state.cart = [];
            resetDiscountUI();
            renderCart();
            document.getElementById('customerName').value = '';
            document.getElementById('tableNumber').value = '';
            window.closeModal('paymentModal');
            loadKasirExpenses();
            setTimeout(window.showReceipt, 300);
        } catch (e) {
            showToast('❌ ' + (e.message || 'Gagal'), true);
        } finally {
            btn.innerText = 'Konfirmasi';
            btn.disabled = false;
        }
    };

    /* ---------- Struk ---------- */
    function receiptHtml(o) {
        return `<div class="receipt-header"><h3>☕ MASUSPACE</h3><p>Coffee Shop</p><p style="font-size:10px;margin-top:8px">${o.dateLabel}</p><p style="font-size:10px">${escapeHtml(o.number)}</p>${o.extraHeader || ''}</div><div style="margin-bottom:10px">${o.items.map(i => `<div class="receipt-item"><div>${escapeHtml(i.name)} x${i.qty}</div><div>${formatRp(i.unit_price * i.qty)}</div></div>${i.detail ? `<div style="font-size:10px;color:#666">&nbsp;&nbsp;${escapeHtml(i.detail)}</div>` : ''}`).join('')}</div><div class="receipt-total"><div class="receipt-item"><span>Subtotal</span><span>${formatRp(o.subtotal)}</span></div>${o.discount > 0 ? `<div class="receipt-item"><span>Diskon</span><span>-${formatRp(o.discount)}</span></div>` : ''}<div class="receipt-item" style="font-size:14px"><span>TOTAL</span><span>${formatRp(o.total)}</span></div><div class="receipt-item"><span>Bayar (${escapeHtml(String(o.method).toUpperCase())})</span><span>${formatRp(o.paid)}</span></div>${o.method === 'cash' ? `<div class="receipt-item"><span>Kembali</span><span>${formatRp(o.change)}</span></div>` : ''}</div><div style="text-align:center;margin-top:12px;font-size:10px"><p>━━━━━━━━━━━━━━━━━━━</p><p>Terima kasih!</p><p>Selamat menikmati ☕</p></div>`;
    }
    function printHtml(content) {
        const w = window.open('', '', 'width=400,height=600');
        if (!w) { showToast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak.', true); return; }
        w.document.write(`<html><head><title>Struk</title><style>body{font-family:'Courier New',monospace;font-size:12px;padding:20px}.receipt-item{display:flex;justify-content:space-between;margin-bottom:4px}.receipt-header{text-align:center;margin-bottom:12px;border-bottom:1px dashed #000;padding-bottom:12px}.receipt-total{border-top:1px dashed #000;padding-top:8px;font-weight:bold}</style></head><body>${content}</body></html>`);
        w.document.close();
        w.print();
    }
    window.showReceipt = function () {
        const r = state.currentReceipt;
        if (!r) return;
        document.getElementById('receiptContent').innerHTML = receiptHtml({
            dateLabel: getJakartaDate(), number: r.order_number,
            items: r.items.map(i => ({ name: i.name, qty: i.qty, unit_price: i.unit_price, detail: (i.variant_suhu || '') + '/' + (i.variant_ukuran || '') })),
            subtotal: r.subtotal, discount: r.discount, total: r.total, method: r.payment_method, paid: r.cash_received, change: r.change
        });
        document.getElementById('receiptModal').classList.add('active');
    };
    window.printReceipt = function () { printHtml(document.getElementById('receiptContent').innerHTML); };

    /* ---------- Draft order (disimpan di browser perangkat ini) ---------- */
    const heldOrdersStorageKey = 'masuspace-held-orders';
    function getHeldOrders() {
        try { return JSON.parse(localStorage.getItem(heldOrdersStorageKey) || '[]'); }
        catch (error) { console.error('Draft order rusak:', error); return []; }
    }
    function saveHeldOrders(orders) { localStorage.setItem(heldOrdersStorageKey, JSON.stringify(orders)); }
    function renderHeldOrders() {
        const box = document.getElementById('holdOrdersList');
        if (!box) return;
        const orders = getHeldOrders();
        box.innerHTML = orders.length ? orders.map(o => {
            const items = (o.items || []).map(i => `${escapeHtml(i.name)} × ${Number(i.qty || 0)}`).join(', ');
            const created = o.created_at ? new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '';
            const sub = (o.items || []).reduce((s, i) => s + i.unit_price * i.qty, 0);
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;border-bottom:1px solid var(--border)"><div style="min-width:0"><b>${escapeHtml(o.customer_name || 'Walk-in')}</b> • ${formatRp(sub)}<div style="font-size:12px;color:var(--text-light);margin-top:4px">${items || 'Tanpa menu'} • ${created}</div></div><div style="display:flex;gap:8px;flex-shrink:0"><button class="btn-primary" onclick="window.restoreHeldOrder('${o.id}')">Lanjutkan</button><button class="btn-secondary" onclick="window.deleteHeldOrder('${o.id}')">Hapus</button></div></div>`;
        }).join('') : '<p style="text-align:center;color:var(--text-light);padding:20px">Belum ada draft order di perangkat ini</p>';
    }
    window.showHoldOrders = function () { document.getElementById('holdOrdersModal').classList.add('active'); renderHeldOrders(); };
    window.saveCurrentHeldOrder = function () {
        if (!state.cart.length) { showToast('Tambahkan menu terlebih dahulu sebelum menyimpan draft.', true); return false; }
        const orders = getHeldOrders();
        orders.unshift({
            id: window.crypto?.randomUUID?.() || `draft-${Date.now()}`,
            created_at: new Date().toISOString(),
            cashier: state.currentUser?.full_name || '',
            customer_name: document.getElementById('customerName')?.value.trim() || 'Walk-in',
            table_number: document.getElementById('tableNumber')?.value.trim() || '',
            order_type: state.orderType,
            discount: { ...state.discount },
            items: state.cart
        });
        try { saveHeldOrders(orders); }
        catch (error) { showToast('Draft tidak tersimpan. Periksa penyimpanan browser.', true); return false; }
        state.cart = [];
        resetDiscountUI();
        document.getElementById('customerName').value = '';
        document.getElementById('tableNumber').value = '';
        renderCart();
        renderHeldOrders();
        showToast('Order disimpan sebagai draft di perangkat ini.');
        return true;
    };
    window.restoreHeldOrder = function (id) {
        if (state.cart.length) {
            if (!confirm('Order aktif akan disimpan otomatis sebagai draft, lalu draft ini dilanjutkan. Lanjut?')) return;
            if (!window.saveCurrentHeldOrder()) return;
        }
        const orders = getHeldOrders();
        const index = orders.findIndex(o => o.id === id);
        if (index < 0) { showToast('Draft order tidak ditemukan.', true); renderHeldOrders(); return; }
        const [order] = orders.splice(index, 1);
        try { saveHeldOrders(orders); }
        catch (error) { showToast('Draft tidak dapat dipindahkan dari penyimpanan browser.', true); return; }
        state.cart = Array.isArray(order.items) ? order.items : [];
        state.discount = order.discount || { type: 'percent', value: 0 };
        state.orderType = order.order_type || 'dine_in';
        document.getElementById('discountTypeInline').value = state.discount.value ? state.discount.type : 'none';
        document.getElementById('discountValueInline').value = state.discount.value || '';
        document.getElementById('customerName').value = order.customer_name === 'Walk-in' ? '' : (order.customer_name || '');
        document.getElementById('tableNumber').value = order.table_number || '';
        document.querySelectorAll('.type-btn').forEach((b, i) => b.classList.toggle('active', (i === 0) === (state.orderType === 'dine_in')));
        renderCart();
        window.closeModal('holdOrdersModal');
        showToast('Draft order dilanjutkan.');
    };
    window.deleteHeldOrder = function (id) {
        if (!confirm('Hapus draft order ini?')) return;
        try { saveHeldOrders(getHeldOrders().filter(o => o.id !== id)); }
        catch (error) { showToast('Draft tidak dapat dihapus dari penyimpanan browser.', true); return; }
        renderHeldOrders();
    };

/* ===== AKHIR PART 4 ===== */
/* =====================================================================
   PART 5 dari 6: laporan harian, tutup kasir, riwayat order, laporan
   ===================================================================== */

    /* ---------- Laporan harian + tutup kasir ---------- */
    window.showDailyReport = async function () {
        const today = getTodayJakarta();
        const dayStart = dayStartISO(today);
        const dayEnd = dayEndExclusiveISO(today);
        const content = document.getElementById('dailyReportContent');
        content.innerHTML = '<div style="text-align:center;padding:20px">Memuat...</div>';
        document.getElementById('dailyReportModal').classList.add('active');
        try {
            const [orderResult, expenseResult, cashResult] = await Promise.all([
                supabase.from('orders').select('id,order_number,customer_name,total,payment_method,created_at').gte('created_at', dayStart).lt('created_at', dayEnd).in('status', ['paid', 'completed']),
                supabase.from('expenses').select('amount, cash_sources(name)').gte('created_at', dayStart).lt('created_at', dayEnd),
                supabase.rpc('get_cash_sources')
            ]);
            if (orderResult.error) throw orderResult.error;
            if (expenseResult.error) throw expenseResult.error;
            const orders = orderResult.data || [];
            const expenses = expenseResult.data || [];
            const sum = (list, fn) => list.reduce((s, x) => s + Number(fn(x) || 0), 0);
            const totalRevenue = sum(orders, o => o.total);
            const qrisSales = sum(orders.filter(o => o.payment_method === 'qris'), o => o.total);
            const debitSales = sum(orders.filter(o => o.payment_method === 'debit'), o => o.total);
            const cashSales = totalRevenue - qrisSales - debitSales;
            const totalExpenses = sum(expenses, x => x.amount);
            const cashierExpenses = sum(expenses.filter(x => x.cash_sources?.name === 'Cash Kasir'), x => x.amount);
            // Saldo Cash Kasir diambil dari sistem (berlaku juga setelah tutup kasir); fallback hitungan hari ini bila tidak bisa dibaca
            const systemBalance = cashResult.error ? null : Number((cashResult.data || []).find(s => s.name === 'Cash Kasir')?.current_balance || 0);
            const cashierBalance = systemBalance ?? (cashSales - cashierExpenses);

            let items = [];
            if (orders.length) {
                const { data, error } = await supabase.from('order_items').select('order_id,qty,products(name)').in('order_id', orders.map(o => o.id));
                if (error) throw error;
                items = data || [];
            }
            const menuByOrder = new Map();
            items.forEach(i => {
                const list = menuByOrder.get(i.order_id) || [];
                list.push(escapeHtml(i.products?.name || 'Menu') + ' × ' + Number(i.qty || 0));
                menuByOrder.set(i.order_id, list);
            });

            const canClose = state.currentUser?.role === 'owner' && state.authUserId && systemBalance !== null;
            const closingPanel = canClose
                ? `<section id="cashierClosePanel" data-system="${systemBalance}" class="page-section" style="margin-top:18px"><h4 style="margin:0 0 8px">Tutup Kasir</h4><p style="margin:0 0 12px;color:var(--text-light)">Saldo sistem Cash Kasir: <b>${formatRp(systemBalance)}</b>. Hitung uang fisik, lalu setor ke Cash Umum. Saldo Cash Kasir akan mulai dari Rp 0.</p><div class="input-group"><label>Uang fisik yang dihitung (Rp)</label><input id="cashierPhysicalCash" type="number" min="0" step="1" inputmode="numeric" placeholder="Masukkan hasil hitung fisik"></div><div class="input-group"><label>Catatan selisih (wajib bila ada selisih)</label><input id="cashierCloseNotes" type="text" maxlength="500" placeholder="Contoh: selisih karena uang kembalian"></div><button class="btn-primary" onclick="window.closeCashierShift()"><i class="fas fa-lock"></i> Tutup Kasir & Setor ke Cash Umum</button></section>`
                : '<p style="margin-top:16px;font-size:12px;color:var(--text-light)">Tutup kasir dilakukan oleh Owner.</p>';

            const orderList = orders.map(o => `<div style="display:flex;justify-content:space-between;gap:12px;padding:8px;border-bottom:1px solid var(--border);font-size:12px"><span>${(menuByOrder.get(o.id) || []).join(', ') || 'Tidak ada detail menu'}</span><b>${formatRp(o.total)}</b></div>`).join('');
            const card = (label, val, color) => `<div class="stat-card"><div class="stat-info"><div class="stat-label">${label}</div><div class="stat-value" style="font-size:18px;${color ? 'color:' + color : ''}">${formatRp(val)}</div></div></div>`;
            const line = (label, val) => `<div style="display:flex;justify-content:space-between;padding:6px 0"><span>${label}</span><b>${formatRp(val)}</b></div>`;
            content.innerHTML =
                `<div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:10px;margin-bottom:16px">${card('TOTAL PENJUALAN', totalRevenue)}${card('NON TUNAI', qrisSales + debitSales)}${card('TOTAL PENGELUARAN', totalExpenses, '#ef4444')}${card('SALDO CASH KASIR', cashierBalance, cashierBalance >= 0 ? 'var(--primary)' : '#ef4444')}</div>` +
                `<h4 style="margin:16px 0 10px">Pembayaran</h4><div style="background:var(--bg);padding:12px;border-radius:8px">${line('Cash', cashSales)}${line('QRIS', qrisSales)}${line('Debit', debitSales)}</div>` +
                `<h4 style="margin:16px 0 10px">Menu Terjual Hari Ini</h4><div style="max-height:200px;overflow-y:auto">${orderList || '<p style="color:var(--text-light);text-align:center;padding:20px">Belum ada penjualan</p>'}</div>` + closingPanel;
        } catch (error) {
            content.innerHTML = '<p style="color:#ef4444;text-align:center">Gagal memuat: ' + escapeHtml(error.message) + '</p>';
        }
    };

    window.closeCashierShift = async function () {
        if (state.currentUser?.role !== 'owner' || !state.authUserId) { showToast('Hanya Owner yang masuk lewat Supabase Auth dapat menutup kasir.', true); return; }
        const panel = document.getElementById('cashierClosePanel');
        const field = document.getElementById('cashierPhysicalCash');
        const physicalCash = Number(field?.value);
        if (!field || field.value.trim() === '' || !Number.isSafeInteger(physicalCash) || physicalCash < 0) { showToast('Masukkan hitung fisik dalam angka rupiah bulat.', true); return; }
        const system = Number(panel?.dataset.system || 0);
        const diff = physicalCash - system;
        const notes = document.getElementById('cashierCloseNotes')?.value.trim() || null;
        if (system <= 0 && physicalCash <= 0) { showToast('Tidak ada saldo Cash Kasir untuk ditutup.', true); return; }
        if (diff !== 0 && !notes) { showToast('Ada selisih ' + formatRp(diff) + '. Isi catatan selisih dulu.', true); return; }
        if (!window.confirm('Saldo sistem ' + formatRp(system) + ', fisik ' + formatRp(physicalCash) + ', selisih ' + formatRp(diff) + '.\nSetor ke Cash Umum dan mulai Cash Kasir dari Rp 0?')) return;
        const button = panel.querySelector('button');
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
        try {
            const { data, error } = await supabase.rpc('close_cashier_shift', { p_physical_cash: physicalCash, p_notes: notes });
            if (error) throw error;
            if (!data?.success) throw new Error(data?.message || 'Penutupan kasir gagal.');
            panel.innerHTML = `<h4 style="margin:0 0 8px">Kasir berhasil ditutup</h4><p>Saldo sistem: ${formatRp(data.expected_balance)} · Fisik: ${formatRp(data.physical_balance)} · Selisih: ${formatRp(data.difference)}</p><p>Setoran ke Cash Umum: ${formatRp(data.physical_balance)}. Saldo Cash Kasir sekarang Rp 0.</p>`;
            delete panel.dataset.system;
            showToast('Kasir ditutup; saldo disetor ke Cash Umum.');
        } catch (error) {
            showToast(error.message || 'Tutup kasir gagal.', true);
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-lock"></i> Tutup Kasir & Setor ke Cash Umum';
        }
    };

    /* ---------- Riwayat order ---------- */
    const PAID_STATUS = ['paid', 'completed'];
    async function loadOrders() {
        const requestId = ++orderRequestId;
        const startEl = document.getElementById('orderFilterStart');
        const endEl = document.getElementById('orderFilterEnd');
        if (!window._ordersInit) { window._ordersInit = true; startEl.value = endEl.value = getTodayJakarta(); }
        const start = startEl.value, end = endEl.value;
        if (start && end && start > end) { showToast('Tanggal awal tidak boleh melewati tanggal akhir.', true); return; }
        const tableBody = document.getElementById('ordersTableBody');
        tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px">Memuat riwayat order...</td></tr>';
        try {
            let query = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(500);
            if (start) query = query.gte('created_at', dayStartISO(start));
            if (end) query = query.lt('created_at', dayEndExclusiveISO(end));
            const { data: orderData, error } = await query;
            if (requestId !== orderRequestId) return;
            if (error) throw error;
            const orders = orderData || [];
            if (!orders.length) {
                tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">Tidak ada data</td></tr>';
                document.getElementById('ordersSummary').innerHTML = '';
                return;
            }
            const { data: itemData, error: itemError } = await supabase.from('order_items').select('order_id,qty,products(name)').in('order_id', orders.map(o => o.id));
            if (requestId !== orderRequestId) return;
            if (itemError) throw itemError;
            const menuByOrder = new Map();
            (itemData || []).forEach(i => {
                const list = menuByOrder.get(i.order_id) || [];
                list.push(`${escapeHtml(i.products?.name || 'Produk')} × ${Number(i.qty || 0)}`);
                menuByOrder.set(i.order_id, list);
            });
            let paidCount = 0, totalCash = 0, totalNonCash = 0, totalRevenue = 0;
            tableBody.innerHTML = orders.map(o => {
                const amount = Number(o.total || 0);
                const isPaid = PAID_STATUS.includes(o.status);
                if (isPaid) {
                    paidCount++; totalRevenue += amount;
                    if (o.payment_method === 'cash') totalCash += amount; else totalNonCash += amount;
                }
                const menus = menuByOrder.get(o.id) || [];
                const methodBadge = o.payment_method === 'cash' ? 'success' : o.payment_method === 'qris' ? 'info' : 'warning';
                const statusBadge = isPaid ? 'success' : o.status === 'cancelled' ? 'danger' : 'warning';
                return `<tr><td>${new Date(o.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })}</td><td><span class="badge badge-info">${escapeHtml(o.order_type || '-')}</span></td><td>${escapeHtml(o.customer_name || 'Walk-in')}</td><td>${menus.join(', ') || 'Tidak ada detail menu'}</td><td><span class="badge badge-${methodBadge}">${escapeHtml((o.payment_method || '-').toUpperCase())}</span></td><td><b>${formatRp(amount)}</b></td><td><span class="badge badge-${statusBadge}">${escapeHtml(o.status || '-')}</span></td><td class="order-action-btns"><button onclick="window.viewOrderDetail('${o.id}')" title="Lihat & Cetak"><i class="fas fa-eye"></i></button><button onclick="window.editOrder('${o.id}')" title="Ubah status"><i class="fas fa-edit"></i></button><button class="delete-btn" onclick="window.deleteOrder('${o.id}')" title="Hapus"><i class="fas fa-trash"></i></button></td></tr>`;
            }).join('');
            const card = (label, val) => `<div class="stat-card"><div class="stat-info"><div class="stat-label">${label}</div><div class="stat-value">${val}</div></div></div>`;
            document.getElementById('ordersSummary').innerHTML = `<div class="stats-grid" style="margin-bottom:16px">${card('Total Order', paidCount)}${card('Cash', formatRp(totalCash))}${card('Non-Tunai', formatRp(totalNonCash))}${card('Total Penjualan', formatRp(totalRevenue))}</div>`;
        } catch (error) {
            if (requestId !== orderRequestId) return;
            console.error(error);
            tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#ef4444">Gagal memuat riwayat order. Silakan coba lagi.</td></tr>';
            showToast('Gagal memuat riwayat order: ' + error.message, true);
        }
    }
    window.loadOrders = loadOrders;
    window.resetOrderFilter = function () {
        clearTimeout(orderFilterTimer);
        document.getElementById('orderFilterStart').value = getTodayJakarta();
        document.getElementById('orderFilterEnd').value = getTodayJakarta();
        loadOrders();
    };

    window.viewOrderDetail = async function (orderId) {
        const [orderRes, itemRes] = await Promise.all([
            supabase.from('orders').select('*, app_users(full_name)').eq('id', orderId).single(),
            supabase.from('order_items').select('*, products(name)').eq('order_id', orderId)
        ]);
        const order = orderRes.data;
        if (!order) { showToast('Order tidak ditemukan', true); return; }
        const items = (itemRes.data || []).map(i => ({ name: i.products?.name || 'Produk', qty: i.qty, unit_price: Number(i.unit_price), detail: i.notes || '' }));
        const sub = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
        const total = Number(order.total || 0);
        document.getElementById('orderDetailContent').innerHTML = receiptHtml({
            dateLabel: new Date(order.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
            number: order.order_number,
            extraHeader: `<p style="font-size:10px">Kasir: ${escapeHtml(order.app_users?.full_name || '-')}</p><p style="font-size:10px">Customer: ${escapeHtml(order.customer_name || 'Walk-in')}</p>`,
            items, subtotal: sub, discount: Math.max(0, sub - total), total,
            method: order.payment_method || 'cash', paid: Number(order.paid_amount || total), change: Number(order.change_amount || 0)
        });
        document.getElementById('orderDetailModal').classList.add('active');
    };
    window.printOrderDetail = function () { printHtml(document.getElementById('orderDetailContent').innerHTML); };

    // Order lunas terhubung ke kas, jurnal, dan stok, jadi tidak boleh diubah/dihapus langsung dari tabel
    async function guardOrderChange(orderId, label) {
        if (state.currentUser?.role !== 'owner') { showToast('Hanya Owner yang boleh ' + label + ' order.', true); return null; }
        const { data: o } = await supabase.from('orders').select('id,status,order_number').eq('id', orderId).single();
        if (!o) { showToast('Order tidak ditemukan', true); return null; }
        if (PAID_STATUS.includes(o.status)) { showToast('Order lunas terkunci karena terhubung ke kas & jurnal.', true); return null; }
        return o;
    }
    window.editOrder = async function (orderId) {
        const order = await guardOrderChange(orderId, 'mengubah');
        if (!order) return;
        const newStatus = (prompt(`Ubah status order ${order.order_number}:\n(held / cancelled)`, order.status) || '').trim();
        if (!['held', 'cancelled'].includes(newStatus) || newStatus === order.status) return;
        const { error } = await supabase.from('orders').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', orderId);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Order diupdate!');
        await loadOrders();
    };
    window.deleteOrder = async function (orderId) {
        if (!(await guardOrderChange(orderId, 'menghapus'))) return;
        if (!confirm('Hapus order ini? Data akan hilang permanen.')) return;
        const { error } = await supabase.from('orders').delete().eq('id', orderId);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Order dihapus');
        await loadOrders();
    };

    /* ---------- Laporan penjualan ---------- */
    async function loadReports() {
        document.getElementById('reportStartDate').value = getJakartaMonthStart();
        document.getElementById('reportEndDate').value = getTodayJakarta();
        await window.loadSalesReport();
    }
    window.loadReports = loadReports;
    window.setReportPreset = function (preset) {
        clearTimeout(reportFilterTimer);
        const today = getTodayJakarta();
        document.getElementById('reportStartDate').value = preset === 'week' ? getJakartaDateDaysAgo(6) : preset === 'month' ? getJakartaMonthStart() : today;
        document.getElementById('reportEndDate').value = today;
        window.loadSalesReport();
    };
    window.applyReportFilter = function () { clearTimeout(reportFilterTimer); reportFilterTimer = setTimeout(window.loadSalesReport, 180); };
    window.loadSalesReport = async function () {
        const requestId = ++reportRequestId;
        const start = document.getElementById('reportStartDate').value;
        const end = document.getElementById('reportEndDate').value;
        if (!start || !end) return;
        if (start > end) { showToast('Tanggal awal tidak boleh melewati tanggal akhir.', true); return; }
        const { data: orders, error } = await supabase.from('orders').select('id,total,payment_method,created_at')
            .gte('created_at', dayStartISO(start)).lt('created_at', dayEndExclusiveISO(end)).in('status', PAID_STATUS);
        if (requestId !== reportRequestId) return;
        if (error) { console.error(error); showToast('Gagal memuat laporan: ' + error.message, true); return; }
        const report = orders || [];
        const byDate = new Map();
        let totalRev = 0, totalCash = 0, totalNonCash = 0;
        report.forEach(o => {
            const t = Number(o.total || 0);
            const key = new Date(o.created_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
            const r = byDate.get(key) || { n: 0, cash: 0, qris: 0, debit: 0, total: 0, ts: new Date(o.created_at).getTime() };
            r.n++; r.total += t; totalRev += t;
            if (['cash', 'qris', 'debit'].includes(o.payment_method)) r[o.payment_method] += t;
            if (o.payment_method === 'cash') totalCash += t; else totalNonCash += t;
            byDate.set(key, r);
        });
        const card = (label, val) => `<div class="stat-card"><div class="stat-info"><div class="stat-label">${label}</div><div class="stat-value">${val}</div></div></div>`;
        document.getElementById('reportStats').innerHTML = card('Total Order', report.length) + card('Pendapatan', formatRp(totalRev)) + card('Cash', formatRp(totalCash)) + card('Non-Tunai', formatRp(totalNonCash));
        document.getElementById('reportTableBody').innerHTML = byDate.size
            ? [...byDate.entries()].sort((a, b) => b[1].ts - a[1].ts).map(([d, r]) => `<tr><td>${d}</td><td>${r.n}</td><td>${formatRp(r.cash)}</td><td>${formatRp(r.qris)}</td><td>${formatRp(r.debit)}</td><td><b>${formatRp(r.total)}</b></td></tr>`).join('')
            : '<tr><td colspan="6" style="text-align:center;padding:30px">Tidak ada data</td></tr>';
    };

/* ===== AKHIR PART 5 ===== */
/* =====================================================================
   PART 6 dari 6: Kas & Bank, pengaturan, penutup file
   ===================================================================== */

    /* ---------- Kas & Bank ---------- */
    const EDITABLE_REFS = ['manual', 'adjustment'];
    async function loadCash() {
        const grid = document.getElementById('cashSourcesGrid');
        const body = document.getElementById('cashMutationsBody');
        const fail = msg => {
            if (grid) grid.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
            if (body) body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-light)">${escapeHtml(msg)}</td></tr>`;
            showToast(msg, true);
        };
        try {
            const { data, error: srcError } = await supabase.rpc('get_cash_sources');
            if (srcError) {
                console.error('Gagal memuat sumber kas:', srcError);
                const { data: s } = await supabase.auth.getSession();
                const ownerOk = state.currentUser?.role === 'owner' && state.authUserId && s?.session?.user?.id === state.authUserId;
                fail(ownerOk ? 'Data kas gagal dimuat. Periksa koneksi atau muat ulang halaman.' : 'Sesi Owner tidak aktif. Login kembali untuk membuka Kas & Bank.');
                if (!ownerOk && state.currentUser?.role === 'owner') await window.logout();
                return;
            }
            const sources = data || [];
            grid.innerHTML = sources.length ? sources.map(s => `<div class="cash-card"><h4><i class="fas fa-vault" style="color:var(--primary)"></i>${escapeHtml(s.name)}</h4><div class="balance">${formatRp(s.current_balance)}</div><div class="cash-card-actions"><button class="cash-action-btn primary" onclick="window.showCashAction('transfer','${s.id}')"><i class="fas fa-arrow-right-arrow-left"></i> Transfer</button><button class="cash-action-btn" onclick="window.showCashAction('physical','${s.id}')"><i class="fas fa-calculator"></i> Hitung Fisik</button></div></div>`).join('') : '<div class="empty-state">Belum ada sumber kas aktif.</div>';

            const start = document.getElementById('cashFilterStart')?.value;
            const end = document.getElementById('cashFilterEnd')?.value;
            let q = supabase.from('cash_mutations').select('*, cash_sources(name)').order('created_at', { ascending: false }).limit(200);
            if (start) q = q.gte('created_at', dayStartISO(start));
            if (end) q = q.lt('created_at', dayEndExclusiveISO(end));
            const { data: muts, error: mutError } = await q;
            if (mutError) {
                console.error(mutError);
                body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-light)">Saldo kas dimuat, tetapi riwayat mutasi gagal. Coba muat ulang.</td></tr>';
            } else {
                body.innerHTML = (muts || []).length ? muts.map(m => {
                    const editable = EDITABLE_REFS.includes(m.reference_type);
                    const isIn = m.type === 'in';
                    return `<tr><td>${new Date(m.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td><td><b>${escapeHtml(m.cash_sources?.name || '-')}</b></td><td><span class="badge badge-${isIn ? 'success' : 'warning'}"><i class="fas fa-${isIn ? 'arrow-down' : 'arrow-up'}"></i>${escapeHtml(m.type.toUpperCase())}</span></td><td>${escapeHtml(m.description || '-')}</td><td style="color:${isIn ? 'var(--primary)' : '#ef4444'};font-weight:800">${isIn ? '+' : '-'}${formatRp(m.amount)}</td><td class="mutation-action-btns"><button class="view-btn" onclick="window.viewMutationDetail('${m.id}')" title="Detail"><i class="fas fa-eye"></i></button><button class="edit-btn" onclick="window.editMutation('${m.id}')" title="${editable ? 'Edit' : 'Transaksi terkait dikunci'}" ${editable ? '' : 'disabled'}><i class="fas fa-pen"></i></button><button class="delete-mut-btn" onclick="window.deleteMutation('${m.id}')" title="${editable ? 'Hapus' : 'Transaksi terkait dikunci'}" ${editable ? '' : 'disabled'}><i class="fas fa-trash"></i></button></td></tr>`;
                }).join('') : '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-light)">Belum ada mutasi kas</td></tr>';
            }
            const opts = withBalance => sources.map(s => `<option value="${s.id}">${escapeHtml(s.name)}${withBalance ? ' (' + formatRp(s.current_balance) + ')' : ''}</option>`).join('');
            document.getElementById('transferFrom').innerHTML = opts(true);
            document.getElementById('transferTo').innerHTML = opts(false);
            document.getElementById('addMutationSource').innerHTML = opts(true);
        } catch (error) {
            console.error(error);
            fail('Kas & Bank gagal dimuat. Coba muat ulang halaman atau login kembali.');
        }
    }
    window.loadCash = loadCash;

    window.showAddMutationModal = function () {
        document.getElementById('addMutationAmount').value = '';
        document.getElementById('addMutationDesc').value = '';
        document.getElementById('addMutationModal').classList.add('active');
    };
    window.saveManualMutation = async function () {
        const sourceId = document.getElementById('addMutationSource').value;
        const amount = parseFloat(document.getElementById('addMutationAmount').value) || 0;
        const desc = document.getElementById('addMutationDesc').value.trim();
        if (!sourceId) { showToast('Pilih sumber kas!', true); return; }
        if (amount <= 0) { showToast('Jumlah harus lebih dari 0!', true); return; }
        if (!desc) { showToast('Deskripsi wajib!', true); return; }
        const { data, error } = await supabase.rpc('add_manual_mutation', { p_source_id: sourceId, p_type: document.getElementById('addMutationType').value, p_amount: amount, p_description: desc, p_created_by: state.currentUser?.id || null });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Mutasi berhasil ditambahkan!');
        window.closeModal('addMutationModal');
        await loadCash();
    };

    async function doTransfer(from, to, amount, desc) {
        if (!from || !to || from === to) { showToast('Sumber & tujuan harus berbeda!', true); return false; }
        if (amount <= 0) { showToast('Jumlah wajib!', true); return false; }
        const { data, error } = await supabase.rpc('transfer_cash', { p_from: from, p_to: to, p_amount: amount, p_desc: desc, p_by: state.currentUser?.id || null });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return false; }
        showToast('Transfer berhasil!');
        return true;
    }
    window.showTransferModal = function () {
        document.getElementById('transferAmount').value = '';
        document.getElementById('transferDesc').value = '';
        document.getElementById('transferModal').classList.add('active');
    };
    window.processTransfer = async function () {
        const ok = await doTransfer(document.getElementById('transferFrom').value, document.getElementById('transferTo').value, parseFloat(document.getElementById('transferAmount').value) || 0, document.getElementById('transferDesc').value.trim());
        if (ok) { window.closeModal('transferModal'); await loadCash(); }
    };

    window.showCashAction = async function (action, sourceId) {
        const { data } = await supabase.rpc('get_cash_sources');
        const sources = data || [];
        const src = sources.find(s => s.id === sourceId);
        if (!src) { showToast('Sumber kas tidak ditemukan', true); return; }
        const content = document.getElementById('cashActionContent');
        document.getElementById('cashActionTitle').innerText = action === 'transfer' ? `Transfer dari ${src.name}` : `Hitung Fisik - ${src.name}`;
        content.innerHTML = action === 'transfer'
            ? `<div class="input-group"><label>Ke Sumber</label><select id="cashActionTo">${sources.filter(s => s.id !== sourceId).map(s => `<option value="${s.id}">${escapeHtml(s.name)} (${formatRp(s.current_balance)})</option>`).join('')}</select></div><div class="input-group"><label>Jumlah (Rp)</label><input type="number" id="cashActionAmount" placeholder="0"></div><div class="input-group"><label>Keterangan</label><input type="text" id="cashActionDesc" placeholder="Keterangan transfer"></div><button class="add-to-cart-btn" onclick="window.processCashAction('transfer','${sourceId}')">Transfer Sekarang</button>`
            : `<div class="input-group"><label>Saldo Sistem</label><input type="text" readonly value="${formatRp(src.current_balance)}"></div><div class="input-group"><label>Hitung Fisik (Rp)</label><input type="number" id="cashActionPhysical" placeholder="0"></div><div class="input-group"><label>Keterangan</label><input type="text" id="cashActionDesc" placeholder="Selisih otomatis dicatat"></div><button class="add-to-cart-btn" onclick="window.processCashAction('physical','${sourceId}')">Simpan</button>`;
        document.getElementById('cashActionModal').classList.add('active');
    };
    window.processCashAction = async function (action, sourceId) {
        const desc = document.getElementById('cashActionDesc')?.value.trim() || '';
        if (action === 'transfer') {
            const ok = await doTransfer(sourceId, document.getElementById('cashActionTo')?.value, parseFloat(document.getElementById('cashActionAmount')?.value) || 0, desc);
            if (!ok) return;
        } else {
            const raw = document.getElementById('cashActionPhysical')?.value;
            const physical = Number(raw);
            if (raw === '' || !Number.isFinite(physical) || physical < 0) { showToast('Masukkan hitung fisik yang valid!', true); return; }
            const { data, error } = await supabase.rpc('reconcile_cash_balance', { p_source_id: sourceId, p_physical_balance: physical, p_description: desc });
            if (error || !data?.success) { showToast('Gagal menyimpan hitung fisik: ' + (error?.message || data?.message || 'Unknown'), true); return; }
            showToast(data.no_change ? 'Saldo fisik sudah sesuai dengan saldo sistem.' : 'Hitung fisik disimpan dan selisih dicatat.');
        }
        window.closeModal('cashActionModal');
        await loadCash();
    };

    window.viewMutationDetail = async function (id) {
        const { data: m } = await supabase.from('cash_mutations').select('*, cash_sources(name)').eq('id', id).single();
        if (!m) { showToast('Mutasi tidak ditemukan', true); return; }
        const row = (l, v) => `<div class="mutation-detail-row"><span class="mutation-detail-label">${l}</span><span class="mutation-detail-value">${v}</span></div>`;
        let related = '';
        if (m.reference_type === 'sale') {
            const { data: o } = await supabase.from('orders').select('order_number,customer_name,payment_method').eq('id', m.reference_id).single();
            if (o) related = row('No. Order', escapeHtml(o.order_number)) + row('Customer', escapeHtml(o.customer_name || 'Walk-in')) + row('Metode Bayar', escapeHtml((o.payment_method || 'cash').toUpperCase()));
        } else if (m.reference_type === 'expense') {
            const { data: x } = await supabase.from('expenses').select('category,description').eq('id', m.reference_id).single();
            if (x) related = row('Kategori', escapeHtml(x.category)) + row('Deskripsi', escapeHtml(x.description || '-'));
        } else if (m.reference_type) {
            related = row('Jenis', escapeHtml(String(m.reference_type).toUpperCase())) + (m.reference_type === 'transfer' ? row('Posisi', m.type === 'out' ? 'Sumber Transfer' : 'Tujuan Transfer') : '');
        }
        const isIn = m.type === 'in';
        document.getElementById('mutationDetailContent').innerHTML =
            row('Tanggal & Waktu', new Date(m.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })) + row('Sumber Kas', escapeHtml(m.cash_sources?.name || '-')) +
            row('Tipe', `<span class="badge badge-${isIn ? 'success' : 'warning'}">${escapeHtml(m.type.toUpperCase())}</span>`) +
            `<div class="mutation-detail-row"><span class="mutation-detail-label">Jumlah</span><span class="mutation-detail-value" style="color:${isIn ? 'var(--primary)' : '#ef4444'};font-size:18px">${isIn ? '+' : '-'}${formatRp(m.amount)}</span></div>` +
            row('Deskripsi', escapeHtml(m.description || '-')) +
            (related ? `<div style="margin-top:20px;padding-top:20px;border-top:2px solid var(--border)"><h4 style="margin-bottom:12px;font-size:14px;color:var(--primary-dark)">Informasi Terkait</h4>${related}</div>` : '');
        document.getElementById('mutationDetailModal').classList.add('active');
    };
    window.editMutation = async function (id) {
        const { data: m } = await supabase.from('cash_mutations').select('*').eq('id', id).single();
        if (!m) { showToast('Mutasi tidak ditemukan', true); return; }
        if (!EDITABLE_REFS.includes(m.reference_type)) { showToast('Hanya mutasi manual/adjustment yang bisa diedit', true); return; }
        document.getElementById('editMutationId').value = id;
        document.getElementById('editMutationAmount').value = m.amount;
        document.getElementById('editMutationDesc').value = m.description || '';
        document.getElementById('editMutationModal').classList.add('active');
    };
    window.saveEditedMutation = async function () {
        const amount = parseFloat(document.getElementById('editMutationAmount').value) || 0;
        if (amount <= 0) { showToast('Jumlah wajib!', true); return; }
        const { data, error } = await supabase.rpc('update_cash_mutation', { p_mutation_id: document.getElementById('editMutationId').value, p_new_amount: amount, p_new_description: document.getElementById('editMutationDesc').value.trim() });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Mutasi berhasil diupdate!');
        window.closeModal('editMutationModal');
        await loadCash();
    };
    window.deleteMutation = async function (id) {
        if (!confirm('Hapus mutasi manual atau penyesuaian fisik ini? Saldo dan jurnal terkait akan dibalik.')) return;
        const { data, error } = await supabase.rpc('delete_cash_mutation', { p_mutation_id: id });
        if (error || !data?.success) { showToast('Gagal: ' + (error?.message || data?.message || 'Unknown'), true); return; }
        showToast('Mutasi berhasil dihapus!');
        await loadCash();
    };

    /* ---------- Pengaturan ---------- */
    async function loadSettings() {
        const tab = state.settingsTab || 'profile';
        const content = document.getElementById('settingsContent');
        if (tab === 'profile') {
            const u = state.currentUser;
            content.innerHTML = `<div class="profile-section"><h3 style="margin-bottom:16px"><i class="fas fa-user-circle" style="color:var(--primary);margin-right:8px"></i>Profil Saya</h3><div class="profile-photo-section"><div class="profile-photo-preview" onclick="window.openPhotoUpload()">${u?.avatar_url && (u.avatar_url.startsWith('http') || u.avatar_url.startsWith('data:image')) ? `<img src="${escapeHtml(u.avatar_url)}" alt="Profil">` : '<i class="fas fa-user"></i>'}</div><div style="flex:1"><p style="font-size:13px;color:var(--text-light);margin-bottom:8px">Klik foto untuk upload</p><button class="btn-secondary" onclick="window.openPhotoUpload()"><i class="fas fa-camera"></i> Upload Foto</button></div></div><div class="input-group"><label>Nama Lengkap</label><input type="text" id="profileFullName" value="${escapeHtml(u?.full_name || '')}"></div><div class="input-group"><label>Password Baru</label><input type="password" id="profilePassword" placeholder="Kosongkan jika tidak diubah"></div><button class="btn-primary" onclick="window.saveProfile()"><i class="fas fa-save"></i> Simpan Profil</button></div>`;
        } else if (tab === 'users') {
            const { data } = await supabase.from('app_users').select('id, username, full_name, role').eq('is_active', true).order('full_name');
            content.innerHTML = `<div class="profile-section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3><i class="fas fa-users" style="color:var(--primary);margin-right:8px"></i>Manajemen User</h3><button class="btn-primary" onclick="window.showUserForm()"><i class="fas fa-plus"></i> Tambah User</button></div><div class="user-list">${(data || []).map(u => `<div class="user-list-item"><div class="user-list-info"><div class="user-avatar">${escapeHtml(u.full_name.charAt(0).toUpperCase())}</div><div><div class="user-name">${escapeHtml(u.full_name)}</div><div class="user-role">@${escapeHtml(u.username)} • ${escapeHtml(u.role)}</div></div></div><div class="user-list-actions"><button class="btn-secondary" style="padding:6px 10px;font-size:11px" onclick="window.editUser('${u.id}')"><i class="fas fa-edit"></i></button><button class="btn-secondary" style="padding:6px 10px;font-size:11px;color:#ef4444" onclick="window.deleteUser('${u.id}')"><i class="fas fa-trash"></i></button></div></div>`).join('')}</div></div>`;
        } else {
            const { data } = await supabase.from('settings').select('*');
            const s = {};
            (data || []).forEach(r => { s[r.key] = r.value; });
            if (tab === 'store') {
                const st = s.store_info || {};
                content.innerHTML = `<div class="settings-card"><h3><i class="fas fa-store"></i> Info Toko</h3><div class="input-group"><label>Nama Toko</label><input type="text" id="settingStoreName" value="${escapeHtml(st.name || 'MasuSpace Coffee')}"></div><div class="input-group"><label>Alamat</label><input type="text" id="settingAddress" value="${escapeHtml(st.address || '')}"></div><div class="input-group"><label>Telepon</label><input type="text" id="settingPhone" value="${escapeHtml(st.phone || '')}"></div><div class="input-group"><label>Email</label><input type="email" id="settingEmail" value="${escapeHtml(st.email || '')}"></div><button class="btn-primary" onclick="window.saveSettings('store_info')"><i class="fas fa-save"></i> Simpan</button></div>`;
            } else {
                const tax = s.tax || {};
                content.innerHTML = `<div class="settings-card"><h3><i class="fas fa-percent"></i> Pajak</h3><div class="input-group"><label>Aktifkan Pajak</label><select id="settingTaxEnabled"><option value="true" ${tax.enabled ? 'selected' : ''}>Ya</option><option value="false" ${!tax.enabled ? 'selected' : ''}>Tidak</option></select></div><div class="input-group"><label>Rate (%)</label><input type="number" id="settingTaxRate" min="0" max="100" value="${Number(tax.rate || 0)}"></div><p style="font-size:12px;color:var(--text-light);margin-bottom:10px">Catatan: pajak belum dihitung di kasir (tax = 0).</p><button class="btn-primary" onclick="window.saveSettings('tax')"><i class="fas fa-save"></i> Simpan</button></div>`;
            }
        }
    }
    window.loadSettings = loadSettings;
    window.switchSettingsTab = function (tab, btn) {
        state.settingsTab = tab;
        document.querySelectorAll('#page-settings .tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        loadSettings();
    };
    // Hanya menyimpan tab yang sedang dibuka agar tidak menimpa pengaturan lain
    window.saveSettings = async function (key) {
        const value = key === 'store_info'
            ? { name: document.getElementById('settingStoreName').value.trim() || 'MasuSpace Coffee', address: document.getElementById('settingAddress').value.trim(), phone: document.getElementById('settingPhone').value.trim(), email: document.getElementById('settingEmail').value.trim() }
            : { enabled: document.getElementById('settingTaxEnabled').value === 'true', rate: Math.min(Math.max(parseFloat(document.getElementById('settingTaxRate').value) || 0, 0), 100) };
        const { error } = await supabase.rpc('save_setting', { p_key: key, p_value: value });
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('Pengaturan disimpan!');
    };

    window.openPhotoUpload = function () { state.pendingPhotoBase64 = null; document.getElementById('photoUploadModal').classList.add('active'); };
    window.handlePhotoUpload = function (event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { showToast('Ukuran file maksimal 2MB!', true); return; }
        if (!file.type.startsWith('image/')) { showToast('Hanya file gambar!', true); return; }
        const reader = new FileReader();
        reader.onload = e => { state.pendingPhotoBase64 = e.target.result; document.getElementById('photoUploadPreview').innerHTML = `<img src="${e.target.result}" alt="Preview">`; };
        reader.readAsDataURL(file);
    };
    window.saveUploadedPhoto = async function () {
        if (!state.pendingPhotoBase64) { showToast('Pilih foto dulu!', true); return; }
        const { error } = await supabase.from('app_users').update({ avatar_url: state.pendingPhotoBase64 }).eq('id', state.currentUser.id);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        state.currentUser.avatar_url = state.pendingPhotoBase64;
        setAvatar(document.getElementById('userAvatar'), state.currentUser);
        setAvatar(document.getElementById('userAvatar2'), state.currentUser);
        state.pendingPhotoBase64 = null;
        showToast('Foto profil diupdate!');
        window.closeModal('photoUploadModal');
        loadSettings();
    };
    window.saveProfile = async function () {
        const fullName = document.getElementById('profileFullName').value.trim();
        const password = document.getElementById('profilePassword').value;
        if (!fullName) { showToast('Nama wajib!', true); return; }
        if (password && password.length < 6) { showToast('Password minimal 6 karakter.', true); return; }
        const { error } = await supabase.from('app_users').update({ full_name: fullName }).eq('id', state.currentUser.id);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        // Password Owner ada di Supabase Auth, bukan di tabel app_users
        if (password) {
            const { error: pwError } = await supabase.auth.updateUser({ password });
            if (pwError) { showToast('Nama tersimpan, tetapi password gagal diubah: ' + pwError.message, true); return; }
            document.getElementById('profilePassword').value = '';
        }
        state.currentUser = { ...state.currentUser, full_name: fullName };
        ['userName', 'userName2'].forEach(id => { document.getElementById(id).innerText = fullName; });
        setAvatar(document.getElementById('userAvatar'), state.currentUser);
        setAvatar(document.getElementById('userAvatar2'), state.currentUser);
        showToast('Profil disimpan!');
    };

    window.showUserForm = function () {
        document.getElementById('userFormTitle').innerText = 'Tambah User';
        ['editUserId', 'editUserFullName', 'editUserUsername', 'editUserPassword'].forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('editUserRole').value = 'kasir';
        document.getElementById('userFormModal').classList.add('active');
    };
    window.editUser = async function (id) {
        const { data } = await supabase.from('app_users').select('id, username, full_name, role').eq('id', id).single();
        if (!data) return;
        document.getElementById('userFormTitle').innerText = 'Edit User';
        document.getElementById('editUserId').value = data.id;
        document.getElementById('editUserFullName').value = data.full_name;
        document.getElementById('editUserUsername').value = data.username;
        document.getElementById('editUserPassword').value = '';
        document.getElementById('editUserRole').value = data.role;
        document.getElementById('userFormModal').classList.add('active');
    };
    window.saveUser = async function () {
        const id = document.getElementById('editUserId').value || null;
        const fullName = document.getElementById('editUserFullName').value.trim();
        const username = document.getElementById('editUserUsername').value.trim();
        const password = document.getElementById('editUserPassword').value;
        const role = document.getElementById('editUserRole').value;
        if (!fullName || !username) { showToast('Nama dan username wajib!', true); return; }
        if (!id && !password) { showToast('Password wajib untuk user baru!', true); return; }
        const userData = { full_name: fullName, username, role };
        if (password) userData.password_hash = password;
        const { error } = id ? await supabase.from('app_users').update(userData).eq('id', id) : await supabase.from('app_users').insert({ ...userData, is_active: true });
        if (error) { showToast('Gagal: ' + (error.code === '23505' ? 'Username sudah dipakai.' : error.message), true); return; }
        showToast('User disimpan!');
        window.closeModal('userFormModal');
        await loadSettings();
        await loadUsersToDropdown();
    };
    window.deleteUser = async function (id) {
        if (id === state.currentUser.id) { showToast('Tidak bisa hapus user sendiri!', true); return; }
        if (!confirm('Hapus user ini?')) return;
        const { error } = await supabase.from('app_users').update({ is_active: false }).eq('id', id);
        if (error) { showToast('Gagal: ' + error.message, true); return; }
        showToast('User dihapus');
        await loadSettings();
        await loadUsersToDropdown();
    };

    /* ---------- Modal & start ---------- */
    window.closeModal = function (id) { document.getElementById(id)?.classList.remove('active'); };
    document.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('active'); });

    document.addEventListener('DOMContentLoaded', function () {
        loadUsersToDropdown();
        window.restoreOwnerSession();
        ['dashboardStartDate', 'dashboardEndDate'].forEach(id => document.getElementById(id)?.addEventListener('change', window.applyDashboardFilter));
        ['orderFilterStart', 'orderFilterEnd'].forEach(id => document.getElementById(id)?.addEventListener('change', () => { clearTimeout(orderFilterTimer); orderFilterTimer = setTimeout(loadOrders, 180); }));
        ['reportStartDate', 'reportEndDate'].forEach(id => document.getElementById(id)?.addEventListener('change', window.applyReportFilter));
        document.getElementById('loginForm')?.addEventListener('submit', function (e) { e.preventDefault(); window.handleLogin(e); });
    });
})();
