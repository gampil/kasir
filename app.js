// ==========================================================================
// KONFIGURASI PUSAT (Master URL harus persis sama dengan Web Owner)
// ==========================================================================
const MASTER_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwidT5jhAd4vtRpOiqRf0C5yc8quxuzTioutoYdF9d2NufVCbtS0moyvH6GCrhOxkgx/exec";

// BACKEND CONFIGURATION (MULTI-TENANT): Mengambil URL dari local storage jika ada
let SCRIPT_URL = localStorage.getItem('tenant_script_url') || "";

// PENGATURAN TOKO (MULTI-TENANT)
let tenantName = localStorage.getItem('tenant_name') || "Forresa Laundry";
let tenantPhone = localStorage.getItem('tenant_phone') || "628123456789";

// STATE VARIABEL & DATABASE LOCAL MEMORY
let currentCashier = "";
let cart = [];
let isNewCustomerMode = false;
let isLoading = true;

let services = [];
let customers = [];
let paymentMethods = ['Tunai / Cash', 'QRIS', 'Transfer Bank'];
let orders = [];
let expenses = [];

// DATA DARI MASTER DB
let masterBranches = [];
let masterCashiers = [];
let isMasterLoaded = false;
// --- FITUR KATEGORI AKTIF ---
let activeCategory = 'Semua';

function setServiceCategory(cat) {
    activeCategory = cat;
    renderServicesGrid();
}

// --- FUNGSI PEMBULATAN HARGA ANTI-KERITING ---
// Aturan: 100-300 ke bawah (0), 400-700 jadi 500, 800-900 ke atas (1000)
function bulatkanHarga(harga) {
    let sisa = Math.round(harga) % 1000;
    let basis = Math.round(harga) - sisa;

    if (sisa < 400) return basis;            // Contoh: 25.100 atau 25.300 -> 25.000
    if (sisa >= 400 && sisa < 800) return basis + 500; // Contoh: 25.400 atau 25.700 -> 25.500
    return basis + 1000;                     // Contoh: 25.800 atau 25.900 -> 26.000
}
// SESSION CONTROL LOGIC
window.addEventListener('DOMContentLoaded', () => {
    updateTenantUI();
    syncMasterData();
    loadReceiptSettings();

    // Tambahkan fitur agar layar tidak mati otomatis saat kasir buka aplikasi
    if ('wakeLock' in navigator) {
        let wakeLock = null;
        const requestWakeLock = async () => {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
            } catch (err) {
                console.log(`${err.name}, ${err.message}`);
            }
        };
        requestWakeLock();
        // Memastikan layar tetap terjaga jika halaman di-refresh
        document.addEventListener('visibilitychange', () => {
            if (wakeLock !== null && document.visibilityState === 'visible') {
                requestWakeLock();
            }
        });
    }


    const urlParams = new URLSearchParams(window.location.search);
    const orderParam = urlParams.get('order');

    if (orderParam) {
        console.log("Aplikasi dibuka oleh pelanggan, bypass gerbang login admin.");
        return;
    }

    const savedCashier = localStorage.getItem('active_cashier');
    if (savedCashier) {
        currentCashier = savedCashier;
        showMainApp();
    }

    const payDropdown = document.getElementById('cart-payment');
    if (payDropdown) {
        payDropdown.addEventListener('change', handlePaymentMethodChange);
    }
});

// ===============================================================
// LOGIKA LOGIN MENGGUNAKAN MASTER DB
// ===============================================================
async function syncMasterData() {
    if (!MASTER_SCRIPT_URL || MASTER_SCRIPT_URL.includes("TEMPEL_LINK")) return;
    try {
        // TAMBAHAN ANTI-CACHE: &t=${Date.now()}
        const response = await fetch(`${MASTER_SCRIPT_URL}?action=getMasterData&t=${Date.now()}`);
        const data = await response.json();
        if (data.status === 'success') {
            masterBranches = data.branches || [];
            masterCashiers = data.cashiers || [];
            isMasterLoaded = true;
            console.log("Sinkronisasi Master Database Berhasil.");
        }
    } catch (e) {
        console.error("Gagal mengambil data dari Master DB:", e);
    }
}

async function submitLogin() {
    const nameInput = document.getElementById('input-cashier-name').value.trim();
    const pinInput = document.getElementById('input-input-pin') ? document.getElementById('input-input-pin').value : (document.getElementById('input-cashier-pin') ? document.getElementById('input-cashier-pin').value.trim() : "");

    if (!nameInput) return alert('Nama kasir wajib dimasukkan!');
    if (!pinInput) return alert('PIN keamanan wajib dimasukkan!');

    if (!isMasterLoaded) {
        triggerNotification("Memvalidasi data ke server Master...");
        await syncMasterData();
    }

    // Cek kecocokan nama dan PIN dengan data di Master DB
    const validCashier = masterCashiers.find(c => c.name.toLowerCase() === nameInput.toLowerCase() && String(c.pin) === String(pinInput));

    if (validCashier) {
        currentCashier = validCashier.name;
        localStorage.setItem('active_cashier', currentCashier);
        showMainApp();
        triggerNotification(`Selamat bertugas, ${currentCashier}! 👋`);
    } else {
        alert('❌ Kombinasi Nama Kasir atau PIN Rahasia Salah! Akses ditolak.');
    }
}

function showMainApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('display-cashier').innerText = currentCashier;

    loadSettingsUI();
    setDefaultDates();

    setTimeout(function () {
        loadDataFromCloud();
    }, 500);
}

function logoutCashier() {
    localStorage.removeItem('active_cashier');
    location.reload();
}

function loadDataFromCloud() {
    if (SCRIPT_URL === "" || SCRIPT_URL.includes("TEMPEL_URL")) {
        isLoading = false;
        renderServicesGrid();
        populateDropdowns();
        renderOrders();
        calculateFinance();
        return;
    }

    console.log("Sedang menyelaraskan data dengan Google Sheets...");
    isLoading = true;
    renderServicesGrid();
    renderOrders();
    calculateFinance();

    fetch(`${SCRIPT_URL}?action=read`)
        .then(response => response.json())
        .then(cloudData => {
            if (!cloudData || cloudData.error) throw new Error("Data tidak valid");
            isLoading = false;
            // KODE BARU: Hanya ambil dari Sheet Pelanggan
            if (cloudData.customers && cloudData.customers.length > 0) {
                customers = cloudData.customers;
            } else {
                // Jika Sheet Pelanggan kosong, maka customers jadi kosong (tidak ambil dari transaksi)
                customers = [];
            }
            populateDropdowns();
            if (cloudData.customServices && cloudData.customServices.length > 0) {
                services = cloudData.customServices.map(s => ({ ...s, icon: s.icon || 'fa-box-tissue' }));
            } else { services = []; }

            if (cloudData.transactions && cloudData.transactions.length > 0) {
                orders = cloudData.transactions.map(t => {
                    let parsedItems = [];
                    if (t.itemsDetail) {
                        try { parsedItems = typeof t.itemsDetail === 'string' ? JSON.parse(t.itemsDetail) : t.itemsDetail; } catch (e) { parsedItems = []; }
                    }

                    return {
                        id: t.id,
                        customer: t.customer,
                        phone: t.phone,
                        service: t.service,
                        total: Number(t.total),
                        cashier: t.cashier,
                        method: t.method,
                        status: t.status,
                        paymentStatus: t.paymentStatus ? t.paymentStatus : 'Lunas',
                        cashPaid: t.cashPaid ? Number(t.cashPaid) : Number(t.total),
                        cashChange: t.cashChange ? Number(t.cashChange) : 0,
                        itemsDetail: parsedItems,
                        date: t.date ? t.date : new Date().toISOString(),
                        estimatedPickup: t.estimatedPickup ? t.estimatedPickup : null
                    };
                }).reverse();

                const uniqueCustomerNames = new Set();
                const tempCustomers = [];

                orders.forEach(order => {
                    if (order.customer && order.customer.trim() !== "") {
                        const normalName = order.customer.trim();
                        const lowerName = normalName.toLowerCase();
                        if (!uniqueCustomerNames.has(lowerName)) {
                            uniqueCustomerNames.add(lowerName);
                            tempCustomers.push({ id: `C${tempCustomers.length + 1}`, name: normalName, phone: order.phone || '628123456789' });
                        }
                    }
                });

            } else { orders = []; }

            if (cloudData.expenses && cloudData.expenses.length > 0) { expenses = cloudData.expenses; } else { expenses = []; }

            renderServicesGrid();
            populateDropdowns();
            renderOrders();
            calculateFinance();
        })
        .catch(err => {
            console.error("Gagal sinkron data cloud:", err);
            isLoading = false;
            renderServicesGrid(); populateDropdowns(); renderOrders(); calculateFinance();
        });
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('theme-color'));

    const clickedBtn = Array.from(document.querySelectorAll('.nav-btn')).find(btn => btn.getAttribute('onclick').includes(viewId));
    if (clickedBtn) clickedBtn.classList.add('theme-color');
}

function openNewServiceModal() { document.getElementById('serviceModal').classList.remove('hidden'); }

function saveNewService() {
    const name = document.getElementById('new-service-name').value.trim();
    const price = parseFloat(document.getElementById('new-service-price').value);
    const type = document.getElementById('new-service-type').value;

    if (!name || !price) return alert('Data input menu belum lengkap!');
    const newId = `S-${Math.floor(1000 + Math.random() * 9000)}`;
    const newServicePayload = { id: newId, name, price, type, icon: 'fa-box-tissue' };

    services.push(newServicePayload);
    renderServicesGrid();
    document.getElementById('serviceModal').classList.add('hidden');

    if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
        const payloadToSend = { action: "addService", id: newServicePayload.id, name: newServicePayload.name, price: newServicePayload.price, type: newServicePayload.type };
        fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadToSend) }).catch(err => console.log(err));
    }

    document.getElementById('new-service-name').value = ''; document.getElementById('new-service-price').value = '';
    triggerNotification(`Menu layanan "${name}" sukses ditambahkan!`);
}

function renderServicesGrid() {
    const grid = document.getElementById('services-grid');
    const categoryContainer = document.getElementById('service-categories');
    if (!grid) return;

    // Render tombol kategori dinamis
    if (categoryContainer && services.length > 0) {
        const uniqueCategories = ['Semua', ...new Set(services.map(s => s.type))];
        categoryContainer.innerHTML = uniqueCategories.map(cat => {
            const isActive = activeCategory === cat;
            const activeClass = isActive ? 'theme-bg text-white shadow-xs' : 'bg-slate-100 text-slate-500 hover:bg-slate-200';
            return `<button onclick="setServiceCategory('${cat}')" class="px-4 py-2 rounded-xl text-xs font-semibold ${activeClass} transition-all whitespace-nowrap">${cat}</button>`;
        }).join('');
    }

    if (isLoading) {
        grid.innerHTML = `<div class="bg-slate-200 rounded-2xl h-36 animate-pulse"></div><div class="bg-slate-200 rounded-2xl h-36 animate-pulse"></div>`;
        return;
    }

    // Filter layanan sesuai kategori yang sedang dipilih
    let displayServices = activeCategory === 'Semua' ? services : services.filter(s => s.type === activeCategory);

    if (displayServices.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center italic text-slate-400 py-8 bg-slate-50 rounded-2xl border border-slate-200 border-dashed">Kategori ${activeCategory} masih kosong.</div>`;
        return;
    }

    let htmlContent = '';
    displayServices.forEach(item => {
        const isSelected = cart.some(cartItem => cartItem.id === item.id);
        const borderStyle = isSelected ? 'bg-cyan-50 border-[#40E0D0]' : 'bg-slate-50 border-slate-200';

        htmlContent += `
            <div onclick="selectServiceToCart('${item.id}')" class="bg-white p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between h-36 relative active:scale-95 ${borderStyle} hover:border-[#40E0D0] hover:bg-cyan-50">
                <div class="absolute top-3 right-3 flex gap-2 z-20">
                    <button onclick="event.stopPropagation(); openEditServiceModal('${item.id}')" class="text-[10px] text-amber-500 bg-amber-50 w-6 h-6 rounded-full hover:bg-amber-100 flex items-center justify-center" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="event.stopPropagation(); deleteServiceFromPOS('${item.id}')" class="text-[10px] text-rose-500 bg-rose-50 w-6 h-6 rounded-full hover:bg-rose-100 flex items-center justify-center" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                </div>
                
                <div class="flex justify-between items-start">
                    <span class="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md">${item.type}</span>
                </div>
                <div>
                    <h4 class="font-bold text-slate-800 text-xs mb-0.5 line-clamp-1">${item.name}</h4>
                    <p class="text-sm font-bold theme-color">Rp ${item.price.toLocaleString('id-ID')}</p>
                </div>
            </div>`;
    });
    grid.innerHTML = htmlContent;
}

function openEditServiceModal(id) {
    const match = services.find(s => s.id === id);
    if (!match) return;
    document.getElementById('edit-service-id').value = match.id;
    document.getElementById('edit-service-name').value = match.name;
    document.getElementById('edit-service-price').value = match.price;
    document.getElementById('edit-service-type').value = match.type;
    document.getElementById('editServiceModal').classList.remove('hidden');
}

function closeEditServiceModal() { document.getElementById('editServiceModal').classList.add('hidden'); }

function submitEditService() {
    const id = document.getElementById('edit-service-id').value;
    const name = document.getElementById('edit-service-name').value.trim();
    const price = parseFloat(document.getElementById('edit-service-price').value);
    const type = document.getElementById('edit-service-type').value;

    if (!name || isNaN(price)) return alert('Data pengubahan belum lengkap!');

    const idx = services.findIndex(s => s.id === id);
    if (idx !== -1) {
        services[idx].name = name; services[idx].price = price; services[idx].type = type;
        renderServicesGrid(); closeEditServiceModal();

        if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("TEMPEL_URL")) {
            const editPayload = { action: "editService", id, name, price, type };
            fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editPayload) }).catch(err => console.log(err));
        }
        triggerNotification(`Layanan "${name}" berhasil diperbarui!`);
    }
}

function deleteServiceFromPOS(id) {
    const match = services.find(s => s.id === id);
    if (!match) return;
    if (confirm(`Apakah Anda yakin ingin menghapus layanan "${match.name}"?`)) {
        services = services.filter(s => s.id !== id);
        renderServicesGrid();
        cart = cart.filter(c => c.id !== id);
        renderCart();

        if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("TEMPEL_URL")) {
            const deletePayload = { action: "deleteService", id };
            fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deletePayload) }).catch(err => console.log(err));
        }
        triggerNotification(`Layanan "${match.name}" telah dihapus.`);
    }
}

function populateDropdowns() {
    const custDropdown = document.getElementById('cart-customer');
    const payInput = document.getElementById('cart-payment'); 
    const payGrid = document.getElementById('cart-payment-grid');

    if (custDropdown) {
        if (customers.length > 0) {
            // Pastikan menggunakan 'name' sesuai header 'customer' di sheet
            custDropdown.innerHTML = customers.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        }
        else {
            custDropdown.innerHTML = `<option value="">Belum ada pelanggan terdaftar</option>`;
        }
    }
    
    // LOGIKA BARU: Cetak Grid Metode Pembayaran (Compact)
    if (payGrid && paymentMethods) {
        const currentVal = payInput ? payInput.value : 'Tunai / Cash';
        payGrid.innerHTML = paymentMethods.map(p => {
            // Singkat teksnya agar muat di grid kecil
            let shortName = p === 'Tunai / Cash' ? 'Tunai' : p === 'Transfer Bank' ? 'Trf Bank' : p;
            let isActive = p === currentVal;
            
            // Efek menyala kalau diklik
            let activeClass = isActive 
                ? 'bg-white shadow-sm text-slate-800 border-slate-200' 
                : 'text-slate-400 hover:text-slate-600 border-transparent hover:bg-slate-100';
            
            return `<button type="button" onclick="selectPaymentMethod('${p}')" class="flex items-center justify-center w-full h-full text-[9px] font-bold rounded-lg transition-all border ${activeClass}">${shortName}</button>`;
        }).join('');
    }
}

// Fungsi pendamping ketika tombol Grid diklik
function selectPaymentMethod(method) {
    const payInput = document.getElementById('cart-payment');
    if (payInput) {
        payInput.value = method;       // Simpan nilainya diam-diam
        populateDropdowns();           // Ubah warna tombol yang aktif
        handlePaymentMethodChange();   // Jalankan hitung-hitungan kembalian kasir
    }
}

function selectServiceToCart(id) {
    const service = services.find(s => s.id === id);
    if (!service) return;
    if (!Array.isArray(cart)) cart = [];

    const existingItem = cart.find(item => item.id === id);
    if (existingItem) { existingItem.qty += 1; }
    else { cart.push({ id: service.id, name: service.name, price: service.price, type: service.type, icon: service.icon, qty: 1 }); }

    renderCart(); renderServicesGrid();
    triggerNotification(`Layanan ${service.name} masuk keranjang`);
}

function renderCart() {
    const container = document.getElementById('cart-items');
    if (!container) return;

    if (cart.length === 0) {
        container.innerHTML = `<span class="text-center italic text-slate-400 py-4 bg-slate-50 rounded-2xl border border-slate-100 border-dashed w-full block">Silahkan pilih produk di sebelah kiri...</span>`;
        const totalEl = document.getElementById('total-amount');
        if (totalEl) totalEl.innerText = "Rp 0";
        resetCashCalculationInputs();
        return;
    }

    let html = '<div class="space-y-3 w-full">';
    let totalAkhir = 0;

    cart.forEach((item, index) => {
        const subtotal = bulatkanHarga(item.price * item.qty);
        totalAkhir += subtotal;
        const isKiloan = item.type === 'Kiloan';

        html += `
            <div class="bg-white border-2 border-teal-400 p-4 rounded-2xl shadow-xs w-full flex flex-col gap-3 relative">
                <div class="flex justify-between items-center w-full">
                    <p class="font-extrabold text-slate-800 text-sm tracking-tight pr-4 line-clamp-1 flex-1 text-left">${item.name}</p>
                    <button type="button" onclick="deleteCartItem(${index})" class="text-rose-500 bg-rose-50 w-6 h-6 rounded-full hover:bg-rose-100 transition-all flex items-center justify-center shrink-0 shadow-2xs" title="Hapus Layanan">
                        <i class="fa-solid fa-trash text-[10px]"></i>
                    </button>
                </div>
                <div class="flex justify-between items-center w-full pt-2 border-t border-slate-50">
                    <div class="text-left"><p class="text-[10px] text-slate-400 font-semibold">Rp ${item.price.toLocaleString('id-ID')} / ${isKiloan ? 'Kg' : 'Pcs'}</p></div>
                    <div class="flex items-center gap-1.5">
                        <span class="text-[10px] text-slate-400 font-bold">${isKiloan ? 'Berat:' : 'Jumlah:'}</span>
                        <input type="number" value="${item.qty}" min="0.01" step="${isKiloan ? '0.1' : '1'}" oninput="updateCartQty(${index}, this.value)" class="w-14 bg-slate-50 border border-slate-200 rounded-xl p-1 font-extrabold text-slate-700 text-center outline-none focus:border-[#40E0D0] transition-all text-xs">
                        <span class="text-[10px] text-slate-400 font-bold pr-1">${isKiloan ? 'Kg' : 'Pcs'}</span>
                        <span id="subtotal-${index}" class="font-extrabold text-slate-800 min-w-[70px] text-right text-sm">Rp ${Math.round(subtotal).toLocaleString('id-ID')}</span>
                    </div>
                </div>
            </div>`;
    });

    html += '</div>';
    container.innerHTML = html;

    const totalEl = document.getElementById('total-amount');
    if (totalEl) totalEl.innerText = `Rp ${Math.round(totalAkhir).toLocaleString('id-ID')}`;
    calculateChangeAutomatically();
}

function deleteCartItem(index) {
    const deletedItemName = cart[index].name;
    cart.splice(index, 1);
    renderCart(); renderServicesGrid();
    triggerNotification(`Layanan "${deletedItemName}" dihapus dari keranjang`);
}

function updateCartQty(index, val) {
    let parsed = parseFloat(val);
    if (isNaN(parsed) || parsed < 0) parsed = 0;
    cart[index].qty = parsed;

    const subtotalEl = document.getElementById(`subtotal-${index}`);
    if (subtotalEl) subtotalEl.innerText = `Rp ${bulatkanHarga(cart[index].price * cart[index].qty).toLocaleString('id-ID')}`;

    let totalAkhir = 0;
    cart.forEach((item) => { totalAkhir += bulatkanHarga(item.price * item.qty); });

    const totalAmountEl = document.getElementById('total-amount');
    if (totalAmountEl) totalAmountEl.innerText = `Rp ${Math.round(totalAkhir).toLocaleString('id-ID')}`;
    calculateChangeAutomatically();
}

function handlePaymentMethodChange() {
    const payDropdown = document.getElementById('cart-payment');
    if (!payDropdown) return;

    const payMethod = payDropdown.value;
    const cashWrapper = document.getElementById('wrapper-cash-calculation');
    const inputPaidEl = document.getElementById('cart-cash-paid');
    const safeCart = Array.isArray(cart) ? cart : [];
    const totalHargaAkhir = safeCart.reduce((sum, item) => sum + (item.price * item.qty), 0);

    if (!cashWrapper) return;

    if (payMethod === 'Tunai / Cash') {
        cashWrapper.classList.remove('hidden');
        if (inputPaidEl) inputPaidEl.value = '';
        calculateChangeAutomatically();
    } else {
        cashWrapper.classList.add('hidden');
        if (inputPaidEl) inputPaidEl.value = totalHargaAkhir;
        const displayChangeEl = document.getElementById('cart-cash-change');
        if (displayChangeEl) displayChangeEl.innerText = "Rp 0";
    }
}

function calculateChangeAutomatically() {
    const totalHargaAkhir = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const inputPaidEl = document.getElementById('cart-cash-paid');
    const displayChangeEl = document.getElementById('cart-cash-change');

    if (!inputPaidEl || !displayChangeEl) return;

    const payMethod = document.getElementById('cart-payment') ? document.getElementById('cart-payment').value : 'Tunai / Cash';

    if (payMethod !== 'Tunai / Cash') {
        inputPaidEl.value = totalHargaAkhir;
        displayChangeEl.innerText = "Rp 0";
        displayChangeEl.className = "w-full text-xs bg-slate-100 border border-slate-200 rounded-xl p-3 font-bold text-slate-600";
        return;
    }

    const cashPaidValue = parseFloat(inputPaidEl.value) || 0;

    if (cashPaidValue === 0 || cashPaidValue < totalHargaAkhir) {
        displayChangeEl.innerText = "Rp 0";
        displayChangeEl.className = "w-full text-xs bg-slate-100 border border-slate-200 rounded-xl p-3 font-bold text-rose-500";
    } else {
        const changeResult = cashPaidValue - totalHargaAkhir;
        displayChangeEl.innerText = `Rp ${changeResult.toLocaleString('id-ID')}`;
        displayChangeEl.className = "w-full text-xs bg-emerald-50 border border-emerald-100 rounded-xl p-3 font-bold text-emerald-600";
    }
}

function resetCashCalculationInputs() {
    const inputPaidEl = document.getElementById('cart-cash-paid');
    const displayChangeEl = document.getElementById('cart-cash-change');
    if (inputPaidEl) inputPaidEl.value = '';
    if (displayChangeEl) {
        displayChangeEl.innerText = 'Rp 0';
        displayChangeEl.className = "w-full text-xs bg-slate-100 border border-slate-200 rounded-xl p-3 font-bold text-slate-600";
    }
}

function toggleNewCustomerInput() {
    const toggleInput = document.getElementById('customer-toggle-input');
    const boxOld = document.getElementById('box-old-customer');
    const boxNew = document.getElementById('box-new-customer');

    if (!toggleInput || !boxOld || !boxNew) return;
    isNewCustomerMode = toggleInput.checked;

    if (isNewCustomerMode) {
        boxOld.classList.add('hidden'); boxNew.classList.remove('hidden');
    } else {
        boxOld.classList.remove('hidden'); boxNew.classList.add('hidden');
        document.getElementById('new-cust-name').value = ''; document.getElementById('new-cust-phone').value = '';
    }
}

function processCheckout() {
    if (cart.length === 0) return triggerNotification('Pilih layanan laundry terlebih dahulu!');
    cart = cart.filter(item => item.qty > 0);
    if (cart.length === 0) return alert('❌ Jumlah berat atau pcs layanan tidak boleh kosong atau 0!');

    const payMethod = document.getElementById('cart-payment').value;
    const totalHargaAkhir = cart.reduce((sum, item) => sum + bulatkanHarga(item.price * item.qty), 0);

    let cashPaid = 0; let cashChange = 0;

    if (payMethod === 'Tunai / Cash') {
        const inputPaidEl = document.getElementById('cart-cash-paid');
        cashPaid = parseFloat(inputPaidEl ? inputPaidEl.value : 0) || 0;

        let selectedPaymentStatus = "Lunas";
        const statusDropdown = document.getElementById('cart-payment-status');
        if (statusDropdown) selectedPaymentStatus = statusDropdown.value;

        if (selectedPaymentStatus === "Lunas" && cashPaid < totalHargaAkhir) {
            return alert(`❌ Uang yang dibayar (Rp ${cashPaid.toLocaleString('id-ID')}) kurang dari nominal tagihan total belanja!`);
        }
        if (cashPaid >= totalHargaAkhir) { cashChange = cashPaid - totalHargaAkhir; }
    } else {
        cashPaid = totalHargaAkhir; cashChange = 0;
    }

    // ==========================================================================
    // LOGIKA BARU: NOMOR NOTA BERURUTAN (OTOMATIS 0001 JIKA KOSONG)
    // ==========================================================================
    let nextNum = 1;
    if (orders && orders.length > 0) {
        // Cari angka terbesar dari semua ID transaksi yang ada (Contoh: dari FRS-0025 ambil 25)
        const maxId = orders.reduce((max, o) => {
            if (o.id && o.id.includes('-')) {
                const parts = o.id.split('-');
                const num = parseInt(parts[1], 10);
                return !isNaN(num) && num > max ? num : max;
            }
            return max;
        }, 0);
        nextNum = maxId + 1; // Angka berikutnya adalah angka tertinggi + 1
    }

    // Format angka menjadi 4 digit string, misal: FRS-0001
    const generatedOrderId = `FRS-${String(nextNum).padStart(4, '0')}`;
    // ==========================================================================

    let customerName = ""; let customerPhone = "";

    if (isNewCustomerMode || customers.length === 0) {
        const inputName = document.getElementById('new-cust-name').value.trim();
        const inputPhone = document.getElementById('new-cust-phone').value.trim();

        if (!inputName) return alert('Nama pelanggan baru wajib diisi!');
        customerName = inputName;
        customerPhone = inputPhone ? (inputPhone.startsWith('0') ? '62' + inputPhone.slice(1) : inputPhone) : "-";

        const newCustId = `C${customers.length + 1}`;
        customers.push({ id: newCustId, name: customerName, phone: customerPhone });
        populateDropdowns();

        // ==========================================================
        // KODE BARU: KIRIM DATA PELANGGAN KE GOOGLE SHEETS
        // ==========================================================
        if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("TEMPEL_URL")) {
            const custPayload = { action: "addCustomer", id: newCustId, name: customerName, phone: customerPhone };
            fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(custPayload)
            }).catch(err => console.log("Gagal simpan pelanggan ke sheet:", err));
        }
        // ==========================================================

    } else {
        customerName = document.getElementById('cart-customer').value;
        const targetCust = customers.find(c => c.name === customerName);
        customerPhone = targetCust && targetCust.phone ? targetCust.phone : "-";
    }


    const serviceDetailLabel = cart.map(item => `${item.name} (${item.qty}x)`).join(", ");
    let selectedPaymentStatus = "Lunas";
    const statusDropdown = document.getElementById('cart-payment-status');
    if (statusDropdown) { selectedPaymentStatus = statusDropdown.value; }

    const itemsDetailBackup = cart.map(c => ({ name: c.name, price: c.price, qty: c.qty, type: c.type }));
    const inputOrderDate = document.getElementById('cart-order-date').value;
    const inputPickupDate = document.getElementById('cart-pickup-date').value;

    if (!inputOrderDate || !inputPickupDate) return alert('❌ Tanggal masuk (nota) dan estimasi pengambilan wajib diisi!');

    const checkoutPayload = {
        id: generatedOrderId, customer: customerName, phone: customerPhone, service: serviceDetailLabel,
        total: totalHargaAkhir, cashier: currentCashier || "Kasir", method: payMethod, status: 'Diproses',
        paymentStatus: selectedPaymentStatus, cashPaid: cashPaid, cashChange: cashChange,
        itemsDetail: itemsDetailBackup, date: inputOrderDate, estimatedPickup: inputPickupDate
    };

    orders.unshift(checkoutPayload);
    renderOrders(); calculateFinance(); openReceiptModal(checkoutPayload);

    if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
        const cloudPayload = { action: "checkout", ...checkoutPayload, itemsDetail: JSON.stringify(itemsDetailBackup) };
        fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cloudPayload) })
            .catch(err => console.log("Gagal sinkronisasi cloud:", err));
    }

    cart = []; renderCart();

    const toggleInput = document.getElementById('customer-toggle-input');
    if (toggleInput && toggleInput.checked) toggleInput.checked = false;
    toggleNewCustomerInput();

    document.getElementById('new-cust-name').value = ''; document.getElementById('new-cust-phone').value = '';
    resetCashCalculationInputs(); renderServicesGrid(); setDefaultDates();
    triggerNotification(`Nota ${generatedOrderId} berhasil diproses!`);
}

function openReceiptModal(order) {
    if (document.getElementById('nota-date')) document.getElementById('nota-date').innerText = formatTanggalIndo(order.date);
    if (document.getElementById('nota-date-in')) document.getElementById('nota-date-in').innerText = formatTanggalIndo(order.date);
    if (document.getElementById('nota-estimasi')) document.getElementById('nota-estimasi').innerText = order.estimatedPickup ? formatTanggalIndo(order.estimatedPickup) : "-";

    document.getElementById('nota-id').innerText = order.id;
    document.getElementById('nota-cashier').innerText = order.cashier;
    document.getElementById('nota-customer').innerText = order.customer;

    // --- UPDATE PREVIEW DENGAN PENGATURAN TERBARU ---
    const useLogo = localStorage.getItem('receipt_use_logo') !== 'false';
    const useName = localStorage.getItem('receipt_use_name') === 'true';
    const savedPhone = localStorage.getItem('receipt_phone') || tenantPhone || "628123456789";
    const savedAddress = localStorage.getItem('receipt_address') || "";

    const logoEl = document.getElementById('preview-logo-container');
    const nameEl = document.getElementById('preview-name-container');
    const phoneEl = document.getElementById('nota-tenant-phone');
    const addressEl = document.getElementById('nota-tenant-address');

    if (logoEl) logoEl.style.display = useLogo ? 'flex' : 'none';

    if (nameEl) {
        nameEl.style.display = useName ? 'block' : 'none';
        nameEl.innerText = `====== ${tenantName.toUpperCase()} ======`;
    }

    if (phoneEl) phoneEl.innerText = `Hub.+${savedPhone}`;

    if (addressEl) {
        if (savedAddress !== "") {
            addressEl.innerText = savedAddress;
            addressEl.classList.remove('hidden');
        } else {
            addressEl.classList.add('hidden');
        }
    }
    // ------------------------------------------------


    const notaItemsContainer = document.getElementById('nota-items-list');
    if (notaItemsContainer) {
        if (order.itemsDetail && order.itemsDetail.length > 0) {
            notaItemsContainer.innerHTML = order.itemsDetail.map(item => {
                // Logika pintar penentuan Kg atau Pcs
                let unit = 'x';
                if (item.type) {
                    unit = (item.type === 'Kiloan') ? 'Kg' : 'Pcs';
                } else {
                    // Fallback untuk data nota lama yang belum punya tipe
                    unit = (item.qty % 1 !== 0) ? 'Kg' : 'Pcs';
                }

                // DESAIN BARU (Persis cetakan kertas)
                return `
                <div class="flex flex-col py-0.5">
                    <div class="text-left">${item.name}</div>
                    <div class="text-right">${item.qty} ${unit} @ Rp ${item.price.toLocaleString('id-ID')} -> Rp ${(item.price * item.qty).toLocaleString('id-ID')}</div>
                </div>
                `;
            }).join('');
        } else {
            notaItemsContainer.innerHTML = `<div class="flex justify-between"><span class="font-semibold">${order.service}</span></div>`;
        }
    }

    if (document.getElementById('nota-service')) document.getElementById('nota-service').innerText = order.service;
    if (document.getElementById('nota-price')) document.getElementById('nota-price').innerText = `Rp ${order.total.toLocaleString('id-ID')}`;

    const elementPay = document.getElementById('nota-paymethod') || document.getElementById('nota-payMethod');
    if (elementPay) elementPay.innerText = order.method || "Tunai / Cash";
    if (document.getElementById('nota-payment-status')) document.getElementById('nota-payment-status').innerText = order.paymentStatus || 'Lunas';

    document.getElementById('nota-total').innerText = `Rp ${order.total.toLocaleString('id-ID')}`;
    const displayPaidReceipt = document.getElementById('nota-cash-paid-display');
    const displayChangeReceipt = document.getElementById('nota-cash-change-display');

    if (displayPaidReceipt) displayPaidReceipt.innerText = order.cashPaid ? `Rp ${order.cashPaid.toLocaleString('id-ID')}` : 'Rp 0';
    if (displayChangeReceipt) displayChangeReceipt.innerText = order.cashChange ? `Rp ${order.cashChange.toLocaleString('id-ID')}` : 'Rp 0';

    document.getElementById('track-id').innerText = order.id;
    document.getElementById('track-cust').innerText = order.customer;
    document.getElementById('track-service').innerText = order.service;
    document.getElementById('track-total').innerText = `Rp ${order.total.toLocaleString('id-ID')}`;
    document.getElementById('track-badge').innerText = order.status.toUpperCase();

    const generatedTrackingUrl = `https://foresa.my.id?order=${order.id}`;
    document.getElementById("qrcode").innerHTML = "";
    const qrcodeSvg = new QRCode({ content: generatedTrackingUrl, padding: 0, width: 80, height: 80, color: "#000000", background: "#ffffff", ecl: "L" }).svg();
    document.getElementById("qrcode").innerHTML = qrcodeSvg;
    document.getElementById('receiptModal').classList.remove('hidden');
}

function openReceiptModalById(id) {
    const match = orders.find(o => o.id === id);
    if (match) openReceiptModal(match);
}

function sendWhatsAppReceipt() {
    const id = document.getElementById('nota-id').innerText;
    const customer = document.getElementById('nota-customer').innerText;
    const total = document.getElementById('nota-total').innerText;
    let customerPhone = "";
    const currentOrderData = orders.find(o => o.id === id);

    if (currentOrderData && currentOrderData.phone) {
        customerPhone = currentOrderData.phone.trim().replace(/[-+ _]/g, "");
        if (customerPhone.startsWith("0")) { customerPhone = "62" + customerPhone.slice(1); }
    }

    const trackingUrl = `https://foresa.my.id?order=${id}`;
    const messageText = `Halo, Terima kasih telah mencuci di *${tenantName}*.\n\nBerikut rincian Nota Transaksi digital Anda:\n🆔 No Nota: *${id}*\n👤 Konsumen: *${customer}*\n💰 Total Bill: *${total}*\n\n🌿 Pantau status proses pengerjaan laundry pakaian Anda secara realtime melalui link tautan resmi di bawah ini:\n🔗 ${trackingUrl}`;

    if (customerPhone !== "" && customerPhone !== "-") { window.open(`https://api.whatsapp.com/send?phone=${customerPhone}&text=${encodeURIComponent(messageText)}`, '_blank'); }
    else { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(messageText)}`, '_blank'); }
}

// ====================================================================
// FUNGSI PENCARIAN & UPDATE (VERSI OPTIMASI ANTI-MACET + LOADING)
// ====================================================================

// Variabel penahan waktu agar tidak macet saat ngetik
let searchTimeout = null;

function searchByQR(val) {
    // 1. Isi kotak input secara otomatis jika fungsi dipanggil dari tombol "Lunasi"
    const searchInput = document.querySelector('#view-orders input[type="text"]');
    if (searchInput && searchInput.value !== val) {
        searchInput.value = val;
    }

    // 2. Munculkan efek "Loading Kotak Berkedip (Skeleton)" agar terlihat mulus
    const ordersList = document.getElementById('orders-list');
    if (ordersList) {
        ordersList.innerHTML = `
            <div class="bg-slate-200 rounded-2xl h-36 w-full animate-pulse"></div>
            <div class="bg-slate-200 rounded-2xl h-36 w-full animate-pulse"></div>
            <div class="bg-slate-200 rounded-2xl h-36 w-full animate-pulse hidden sm:block"></div>`;
    }

    // 3. Batalkan pencarian sebelumnya jika user masih ngetik
    if (searchTimeout) clearTimeout(searchTimeout);

    // 4. Tunggu 0.4 detik setelah berhenti ngetik, baru lakukan pencarian (Teknik Debounce)
    searchTimeout = setTimeout(() => {
        renderOrders();
    }, 400);
}

function renderOrders() {
    const ordersList = document.getElementById('orders-list');
    if (!ordersList) return;

    if (isLoading) { /*...biarkan sama...*/ return; }
    if (orders.length === 0) { /*...biarkan sama...*/ return; }

    // Ambil input pencarian Teks & Tanggal
    const searchInput = document.querySelector('#view-orders input[type="text"]');
    const q = searchInput ? searchInput.value.trim().toUpperCase() : "";

    const dateInput = document.getElementById('filter-order-date');
    const filterDate = dateInput ? dateInput.value : "";

    let displayOrders = [];

    // Filter data yang cocok dengan Teks ATAU Tanggal
    if (q !== "" || filterDate !== "") {
        displayOrders = orders.filter(o => {
            const matchQ = q === "" || (o.id && o.id.toUpperCase().includes(q)) ||
                (o.customer && o.customer.toUpperCase().includes(q)) ||
                (o.phone && o.phone.includes(q));

            // PERBAIKAN: Gunakan Date Object agar akurat membaca format dari Google Sheets
            let orderDateOnly = "";
            if (o.date) {
                const dt = new Date(o.date);
                // Pastikan datanya adalah tanggal yang valid
                if (!isNaN(dt.getTime())) {
                    const yr = dt.getFullYear();
                    const mo = String(dt.getMonth() + 1).padStart(2, '0');
                    const dy = String(dt.getDate()).padStart(2, '0');
                    orderDateOnly = `${yr}-${mo}-${dy}`;
                }
            }

            const matchDate = filterDate === "" || orderDateOnly === filterDate;

            return matchQ && matchDate;
        });
    } else {
        displayOrders = orders.slice(0, 50);
    }

    if (displayOrders.length === 0) {
        ordersList.innerHTML = `<div class="col-span-full text-center italic text-slate-400 py-8 border border-dashed rounded-2xl border-slate-200">Tidak ada nota yang cocok.</div>`;
        return;
    }


    // 3. Render HTML Data
    ordersList.innerHTML = displayOrders.map(o => {
        let badgeColor = "bg-amber-50 text-amber-600";
        if (o.status === 'Selesai') badgeColor = "bg-cyan-50 text-cyan-600";
        if (o.status === 'Diambil') badgeColor = "bg-green-50 text-green-600";

        const isBelumBayar = o.paymentStatus === 'Belum Bayar';
        const paymentBoxClass = isBelumBayar
            ? 'bg-rose-50 border border-rose-200 text-rose-600 font-bold px-2.5 py-1 rounded-xl text-[11px] inline-flex items-center gap-1 mt-1.5'
            : 'bg-emerald-50 border border-emerald-200 text-emerald-600 font-bold px-2.5 py-1 rounded-xl text-[11px] inline-flex items-center gap-1 mt-1.5';

        return `
            <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-xs space-y-3">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-mono font-bold text-slate-400">${o.id}</span>
                    <span class="text-[10px] px-2.5 py-0.5 font-bold rounded-full ${badgeColor}">${o.status.toUpperCase()}</span>
                </div>
                <div>
                    <h4 class="font-bold text-slate-800 text-sm">${o.customer}</h4>
                    <p class="text-[11px] text-slate-400">${o.service}</p>
                    <p class="text-[10px] text-slate-400 italic">WA: +${o.phone}</p>
                    <div class="${paymentBoxClass}">
                        <i class="${isBelumBayar ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-check'}"></i> ${o.paymentStatus || 'Lunas'}
                    </div>
                </div>
                <div class="space-y-2 pt-2 border-t border-slate-50">
                    <label class="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Update Status Operasional:</label>
                    <select onchange="updateOrderStatus('${o.id}', this.value)" class="w-full text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-1.5 font-semibold text-slate-700 outline-none focus:border-[#40E0D0]">
                        <option value="Diproses" ${o.status === 'Diproses' ? 'selected' : ''}>⏳ Sedang Diproses</option>
                        <option value="Selesai" ${o.status === 'Selesai' ? 'selected' : ''}>✨ Selesai (Siap Ambil)</option>
                        <option value="Diambil" ${o.status === 'Diambil' ? 'selected' : ''}>✅ Sudah Diambil Pelanggan</option>
                    </select>
                    <select onchange="updatePaymentStatus('${o.id}', this.value)" class="w-full text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-1.5 font-semibold text-slate-700 outline-none focus:border-[#40E0D0] mt-1.5">
                        <option value="Lunas" ${o.paymentStatus === 'Lunas' ? 'selected' : ''}>✔️ Lunas</option>
                        <option value="Belum Bayar" ${o.paymentStatus === 'Belum Bayar' ? 'selected' : ''}>🔴 Belum Bayar</option>
                    </select>
                    <select onchange="updatePaymentMethod('${o.id}', this.value)" class="w-full text-[11px] bg-indigo-50 border border-indigo-100 rounded-lg p-1.5 font-semibold text-indigo-700 outline-none focus:border-indigo-400 mt-1.5">
                        <option value="Tunai / Cash" ${o.method === 'Tunai / Cash' ? 'selected' : ''}>💵 Tunai / Cash</option>
                        <option value="QRIS" ${o.method === 'QRIS' ? 'selected' : ''}>📱 QRIS</option>
                        <option value="Transfer Bank" ${o.method === 'Transfer Bank' ? 'selected' : ''}>💳 Transfer Bank</option>
                    </select>
                </div>
                <div class="flex justify-between items-center pt-2">
                    <span class="text-xs font-bold theme-color">Rp ${o.total.toLocaleString('id-ID')}</span>
                    <div class="flex gap-1">
                        <button onclick="openLiveTrackingPreview('${o.id}')" class="text-[10px] font-bold bg-cyan-50 theme-color px-2.5 py-1.5 rounded-lg hover:bg-cyan-100/50" title="Cek Tampilan Live"><i class="fa-solid fa-eye"></i></button>
                        <button onclick="openReceiptModalById('${o.id}')" class="text-[10px] font-bold bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200">Buka Struk</button>
                    </div>
                </div>
            </div>`;
    }).join('');
}



function updatePaymentMethod(orderId, newMethod) {
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) {
        orders[orderIndex].method = newMethod;
        if (document.activeElement) document.activeElement.blur(); // Anti-macet

        if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
            fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: "updatePaymentMethod", id: orderId, method: newMethod }) }).catch(err => console.log(err));
        }

        setTimeout(() => {
            renderOrders();
            if (typeof calculateFinance === "function") calculateFinance();
            triggerNotification(`Metode bayar nota ${orderId} diubah ke: ${newMethod}`);
        }, 50);
    }
}


function updateOrderStatus(orderId, newStatus) {
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) {
        orders[orderIndex].status = newStatus;
        if (document.activeElement) document.activeElement.blur(); // Anti-macet

        if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
            fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: "updateStatus", id: orderId, status: newStatus }) }).catch(err => console.log(err));
        }

        setTimeout(() => {
            renderOrders();
            triggerNotification(`Status pesanan nota ${orderId} diubah menjadi: ${newStatus}`);
        }, 50);
    }
}

function openLiveTrackingPreview(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    document.getElementById('track-id').innerText = order.id;
    document.getElementById('track-cust').innerText = order.customer;
    document.getElementById('track-service').innerText = order.service;
    document.getElementById('track-total').innerText = `Rp ${order.total.toLocaleString('id-ID')}`;
    document.getElementById('track-badge').innerText = order.status.toUpperCase();

    if (document.getElementById('track-date-in')) document.getElementById('track-date-in').innerText = formatTanggalIndo(order.date);
    if (document.getElementById('track-date-out')) document.getElementById('track-date-out').innerText = order.estimatedPickup ? formatTanggalIndo(order.estimatedPickup) : "-";

    const trackPaymentEl = document.getElementById('track-payment-status');
    if (trackPaymentEl) {
        const isBelumBayar = order.paymentStatus === 'Belum Bayar';
        trackPaymentEl.innerText = isBelumBayar ? '🔴 Belum Bayar' : '🟢 Lunas';
        trackPaymentEl.className = isBelumBayar
            ? 'inline-flex items-center gap-1 font-bold px-2.5 py-1 rounded-xl text-[11px] bg-rose-50 border border-rose-200 text-rose-600 mt-0.5'
            : 'inline-flex items-center gap-1 font-bold px-2.5 py-1 rounded-xl text-[11px] bg-emerald-50 border border-emerald-200 text-emerald-600 mt-0.5';
    }

    const steps = document.querySelectorAll('#view-tracking .relative.pl-6 > div');
    steps.forEach((step) => { setStepActive(step, false, false); });

    if (order.status === "Diproses") {
        setStepActive(steps[0], true, false); setStepActive(steps[1], true, true);
    } else if (order.status === "Selesai") {
        setStepActive(steps[0], true, false); setStepActive(steps[1], true, false); setStepActive(steps[2], true, true);
    } else if (order.status === "Diambil") {
        setStepActive(steps[0], true, false); setStepActive(steps[1], true, false); setStepActive(steps[2], true, false); setStepActive(steps[3], true, false);
    }
    switchView('tracking');
}

function setStepActive(stepElement, isActive, isPulse) {
    if (!stepElement) return;
    const dot = stepElement.querySelector('span:not(.animate-ping)');
    const ping = stepElement.querySelector('.animate-ping');
    const title = stepElement.querySelector('p:nth-of-type(1)');

    if (isActive) {
        if (dot) dot.className = "absolute -left-[31px] top-1 w-4 h-4 rounded-full theme-bg border-2 border-white shadow-sm z-10";
        if (title) title.className = "text-xs font-bold text-slate-700";
    } else {
        if (dot) dot.className = "absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-slate-200 border-2 border-white z-10";
        if (title) title.className = "text-xs font-semibold text-slate-400";
    }

    if (ping) {
        if (isPulse) { ping.className = "absolute -left-[31px] top-1 w-4 h-4 rounded-full theme-bg opacity-75 animate-ping"; }
        else { ping.classList.add('hidden'); }
    }
}

function exportToExcel() {
    if (orders.length === 0) return alert('Data transaksi masih kosong!');
    const ws = XLSX.utils.json_to_sheet(orders);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap Penjualan");
    XLSX.writeFile(wb, "Forresa_Laundry_Report.xlsx");
}

function triggerNotification(msg) {
    const banner = document.getElementById('liveAlert');
    if (!banner) return;
    document.getElementById('alertMessage').innerText = msg;
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 5000);
}

window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const orderParam = urlParams.get('order');

    if (orderParam) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');

        const headerKasir = document.querySelector('header');
        if (headerKasir) headerKasir.style.display = 'none';

        const navBawah = document.querySelector('nav');
        if (navBawah) navBawah.style.display = 'none';

        const mainAppEl = document.getElementById('main-app');
        if (mainAppEl) mainAppEl.className = 'min-h-screen flex flex-col pb-0';

        document.getElementById('track-id').innerText = "MENCARI DATA...";
        document.getElementById('track-cust').innerText = "Sedang mengunduh data dari server...";
        switchView('tracking');

        function fetchStatusPelanggan() {
            if (SCRIPT_URL === "" || SCRIPT_URL.includes("SCRIPT_URL")) return;
            fetch(`${SCRIPT_URL}?order=${encodeURIComponent(orderParam)}`)
                .then(response => response.json())
                .then(cloudData => {
                    if (cloudData && cloudData.transactions && cloudData.transactions.length > 0) {
                        const match = cloudData.transactions[0];
                        openLiveTrackingPreview(match.id);
                        const orderIdx = orders.findIndex(o => o.id.toUpperCase() === match.id.toUpperCase());
                        if (orderIdx !== -1) orders[orderIdx] = match; else orders.unshift(match);
                    } else {
                        document.getElementById('track-id').innerText = "TIDAK DITEMUKAN";
                        document.getElementById('track-cust').innerText = "Maaf, nomor nota tersebut tidak terdaftar.";
                    }
                })
                .catch(err => console.log("Gagal auto-update status:", err));
        }

        fetchStatusPelanggan();
        setInterval(fetchStatusPelanggan, 10000);
    }
});

// ====================================================================
// FUNGSI KONVERSI LOGO KE BINER PRINTER THERMAL (RASTER BIT-IMAGE)
// ====================================================================
async function getLogoPrintData() {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = "logo/print-foresa.jpg"; // Memanggil langsung dari folder web Anda

        img.onload = () => {
            const canvas = document.createElement('canvas');
            const targetWidth = 240; // Ukuran lebar aman untuk printer 58mm
            const targetHeight = Math.round((targetWidth / img.width) * img.height);

            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, targetWidth, targetHeight);
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

            const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
            const pixels = imageData.data;

            const widthBytes = Math.ceil(targetWidth / 8);
            const height = targetHeight;
            const buffer = new Uint8Array(8 + widthBytes * height);

            buffer[0] = 0x1D; buffer[1] = 0x76; buffer[2] = 0x30; buffer[3] = 0x00;
            buffer[4] = widthBytes & 0xFF; buffer[5] = (widthBytes >> 8) & 0xFF;
            buffer[6] = height & 0xFF; buffer[7] = (height >> 8) & 0xFF;

            let offset = 8;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < widthBytes; x++) {
                    let byte = 0;
                    for (let b = 0; b < 8; b++) {
                        const px = (x * 8) + b;
                        if (px < targetWidth) {
                            const idx = (y * targetWidth + px) * 4;
                            const r = pixels[idx], g = pixels[idx + 1], b_color = pixels[idx + 2], a = pixels[idx + 3];
                            const luminance = (0.299 * r + 0.587 * g + 0.114 * b_color);
                            // Cek jika piksel berwarna gelap
                            if (luminance < 128 && a > 128) byte |= (1 << (7 - b));
                        }
                    }
                    buffer[offset++] = byte;
                }
            }
            resolve(buffer);
        };
        img.onerror = () => {
            console.error("Gagal meload logo dari folder web.");
            resolve(null);
        };
    });
}


// ==========================================================
// PENGATURAN STRUK (SIMPAN & MUAT KE MEMORI HP)
// ==========================================================

function saveReceiptSettings() {
    // 1. Ambil semua data dari form
    const phone = document.getElementById('set-phone').value;
    const address = document.getElementById('set-address').value;
    const useLogo = document.getElementById('set-use-logo').checked;
    const useName = document.getElementById('set-use-name').checked;

    // 2. Simpan ke database browser (LocalStorage)
    localStorage.setItem('receipt_phone', phone);
    localStorage.setItem('receipt_address', address);
    localStorage.setItem('receipt_use_logo', useLogo);
    localStorage.setItem('receipt_use_name', useName);

    // 3. Tampilkan Notifikasi Sistem (Ganti alert bawaan dengan triggerNotification)
    triggerNotification("✅ Pengaturan struk berhasil disimpan!");

    // Opsional: Jika ingin tetap ada alert pop-up, buka komentar baris di bawah ini
    // alert("Pengaturan struk berhasil disimpan.");
}


function loadReceiptSettings() {
    const phone = localStorage.getItem('receipt_phone') || "";
    const address = localStorage.getItem('receipt_address') || "";
    const useLogo = localStorage.getItem('receipt_use_logo') !== 'false';
    const useName = localStorage.getItem('receipt_use_name') === 'true';

    // Cari elemen kotaknya
    const phoneInput = document.getElementById('set-phone');
    const addressInput = document.getElementById('set-address');
    const logoCheck = document.getElementById('set-use-logo');
    const nameCheck = document.getElementById('set-use-name');

    // Isi datanya HANYA JIKA kotaknya ada di layar (kebal error)
    if (phoneInput) phoneInput.value = phone;
    if (addressInput) addressInput.value = address;
    if (logoCheck) logoCheck.checked = useLogo;
    if (nameCheck) nameCheck.checked = useName;
}

// ==========================================================
// KONEKSI BLUETOOTH GLOBAL (PAIRING OTOMATIS SAAT KLIK PRINT)
// ==========================================================
const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';
const CMD_SPASI_MINI = new Uint8Array([0x1B, 0x4A, 16]);

let globalPrinterDevice = null;
let globalPrinterServer = null;

async function printBluetoothReceipt() {
    try {
        const notaId = document.getElementById('nota-id').innerText;
        const currentOrderData = orders.find(o => o.id === notaId);
        if (!currentOrderData) { return alert('❌ Data transaksi tidak ditemukan di memori sistem!'); }

        // ==============================================================
        // LOGIKA PAIRING: HANYA MUNCUL SAAT TOMBOL PRINT DIKLIK
        // ==============================================================
        if (!globalPrinterDevice || !globalPrinterDevice.gatt.connected) {
            triggerNotification("Meminta izin akses Printer Bluetooth...");
            globalPrinterDevice = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'MTP' }, { namePrefix: 'RPP' }, { namePrefix: 'POS' }, { namePrefix: 'EPPOS' }, { services: [PRINTER_SERVICE_UUID] }],
                optionalServices: [PRINTER_SERVICE_UUID]
            });

            globalPrinterServer = await globalPrinterDevice.gatt.connect();

            // Bersihkan memori jika printer tiba-tiba mati / terputus
            globalPrinterDevice.addEventListener('gattserverdisconnected', () => {
                console.log("Printer Bluetooth terputus.");
                globalPrinterDevice = null;
                globalPrinterServer = null;
            });
        }

        if (!globalPrinterDevice || !globalPrinterDevice.gatt.connected) {
            return;
        }

        const notaCashier = currentOrderData.cashier || "Kasir";
        const notaCustomer = currentOrderData.customer || "-";
        const notaTotal = currentOrderData.total || 0;
        const notaPaymethod = currentOrderData.method || "Tunai / Cash";
        const notaPaymentStatus = currentOrderData.paymentStatus || "Lunas";
        let paidVal = currentOrderData.cashPaid !== undefined && currentOrderData.cashPaid !== null ? currentOrderData.cashPaid : currentOrderData.total;
        let changeVal = currentOrderData.cashChange !== undefined && currentOrderData.cashChange !== null ? currentOrderData.cashChange : 0;
        const trackingUrl = `https://foresa.my.id?order=${notaId}`;

        const service = await globalPrinterServer.getPrimaryService(PRINTER_SERVICE_UUID);
        const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

        const encoder = new TextEncoder();
        const ESC = 0x1B; const GS = 0x1D;

        const CMD_INIT = new Uint8Array([ESC, 0x40]);
        const CMD_CENTER = new Uint8Array([ESC, 0x61, 1]);
        const CMD_LEFT = new Uint8Array([ESC, 0x61, 0]);
        const CMD_RIGHT = new Uint8Array([ESC, 0x61, 2]);
        const CMD_BOLD_ON = new Uint8Array([ESC, 0x45, 1]);
        const CMD_BOLD_OFF = new Uint8Array([ESC, 0x45, 0]);

        const CMD_FEED = new Uint8Array([ESC, 0x64, 2]);
        const CMD_SMALL_ON = new Uint8Array([ESC, 0x4D, 1]);  
        const CMD_SMALL_OFF = new Uint8Array([ESC, 0x4D, 0]); 
        const CMD_ITALIC_ON = new Uint8Array([ESC, 0x34]);    
        const CMD_ITALIC_OFF = new Uint8Array([ESC, 0x35]);   
        const text = (str) => encoder.encode(str + "\n");

        const qrData = encoder.encode(trackingUrl);
        const qrLength = qrData.length + 3;
        const pL = qrLength & 0xFF; const pH = (qrLength >> 8) & 0xFF;

        const CMD_QR_MODEL = new Uint8Array([GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
        const CMD_QR_SIZE = new Uint8Array([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06]);
        const CMD_QR_ERROR = new Uint8Array([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x44, 0x30]);
        const CMD_QR_STORE = new Uint8Array([GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30, ...qrData]);
        const CMD_QR_PRINT = new Uint8Array([GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);

        let printPayload = [];
        printPayload.push(CMD_INIT);
        printPayload.push(CMD_CENTER);

        const useLogo = localStorage.getItem('receipt_use_logo') !== 'false';
        const useName = localStorage.getItem('receipt_use_name') === 'true';
        const phone = localStorage.getItem('receipt_phone') || tenantPhone || "628123456789";
        const address = localStorage.getItem('receipt_address') || "";

        if (useLogo) {
            if (typeof getLogoPrintData === "function") {
                const logoBuffer = await getLogoPrintData();
                if (logoBuffer) {
                    const CHUNK_SIZE = 256;
                    for (let i = 0; i < logoBuffer.length; i += CHUNK_SIZE) {
                        printPayload.push(logoBuffer.slice(i, i + CHUNK_SIZE));
                    }
                    printPayload.push(CMD_SPASI_MINI);
                }
            }
        }

        if (useName) {
            printPayload.push(CMD_BOLD_ON, text(`====== ${tenantName.toUpperCase()} ======`), CMD_BOLD_OFF);
        }

        printPayload.push(CMD_SMALL_ON, CMD_ITALIC_ON); 
        printPayload.push(text(`Hub.+${phone}`));
        if (address !== "") { printPayload.push(text(address)); }
        printPayload.push(CMD_SMALL_OFF, CMD_ITALIC_OFF); 

        printPayload.push(text("================================"));
        printPayload.push(CMD_LEFT);

        printPayload.push(text(`Tgl Masuk : ${formatTanggalIndo(currentOrderData.date)}`));
        printPayload.push(text(`Estimasi  : ${currentOrderData.estimatedPickup ? formatTanggalIndo(currentOrderData.estimatedPickup) : "-"}`));
        printPayload.push(text(`Invoice   : ${notaId}`));
        printPayload.push(text(`Kasir     : ${notaCashier}`));
        printPayload.push(text(`Customer  : ${notaCustomer}`));
        printPayload.push(text("--------------------------------"));

        if (currentOrderData.itemsDetail && currentOrderData.itemsDetail.length > 0) {
            currentOrderData.itemsDetail.forEach(it => {
                let unit = 'x';
                if (it.type) { unit = (it.type === 'Kiloan') ? 'Kg' : 'Pcs'; }
                else { unit = (it.qty % 1 !== 0) ? 'Kg' : 'Pcs'; }

                printPayload.push(CMD_LEFT, text(`${it.name}`));
                printPayload.push(CMD_RIGHT, text(`${it.qty} ${unit} @ Rp ${it.price.toLocaleString('id-ID')} -> Rp ${(it.price * it.qty).toLocaleString('id-ID')}`));
            });
        } else {
            printPayload.push(CMD_LEFT, text(currentOrderData.service || "Layanan Laundry"));
        }

        printPayload.push(CMD_LEFT, text("--------------------------------"));
        printPayload.push(text(`Pembayaran : ${notaPaymethod}`));
        printPayload.push(text(`Status     : ${notaPaymentStatus}`));
        printPayload.push(text(`Uang Bayar : Rp ${paidVal.toLocaleString('id-ID')}`));
        printPayload.push(text(`Kembalian  : Rp ${changeVal.toLocaleString('id-ID')}`));
        printPayload.push(CMD_BOLD_ON, CMD_RIGHT);
        printPayload.push(text(`TOTAL BILL : Rp ${notaTotal.toLocaleString('id-ID')}`));
        printPayload.push(CMD_BOLD_OFF);
        printPayload.push(CMD_CENTER, text("================================"));
        printPayload.push(text("Scan untuk cek status pesanan:"));

        printPayload.push(CMD_SPASI_MINI);
        printPayload.push(CMD_QR_MODEL, CMD_QR_SIZE, CMD_QR_ERROR, CMD_QR_STORE, CMD_QR_PRINT);
        printPayload.push(CMD_SPASI_MINI);

        printPayload.push(text("Pakaian Bersih, Wangi & Rapi"));
        printPayload.push(text("Terima Kasih :)"));

        printPayload.push(CMD_FEED);

        for (const chunk of printPayload) { await characteristic.writeValue(chunk); }
        triggerNotification('✅ Struk berhasil dicetak');
    } catch (error) {
        console.error("Gagal cetak bluetooth:", error);
        alert('❌ Gagal print Bluetooth. Pastikan browser memiliki izin, printer menyala, dan tidak tersambung ke perangkat lain.');
        globalPrinterDevice = null;
        globalPrinterServer = null;
    }
}


function updatePaymentStatus(orderId, newPaymentStatus) {
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) {
        orders[orderIndex].paymentStatus = newPaymentStatus;

        // ANTI-MACET: Lepaskan fokus klik dari dropdown secara paksa
        if (document.activeElement) document.activeElement.blur();

        if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
            fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: "updatePaymentStatus", id: orderId, paymentStatus: newPaymentStatus }) }).catch(err => console.log("Gagal sinkron cloud:", err));
        }

        // ==============================================================
        // KODE BARU: AUTO-RESET LIST NOTA JIKA SUDAH LUNAS
        // ==============================================================
        if (newPaymentStatus === 'Lunas') {
            const searchInput = document.querySelector('#view-orders input[type="text"]');
            if (searchInput) searchInput.value = ''; // Kosongkan kotak pencarian
        }

        // Tunda refresh UI sejenak agar browser bisa bernapas
        setTimeout(() => {
            renderOrders();
            if (typeof calculateFinance === "function") calculateFinance();
            restoreSearchFilter();
            triggerNotification(`Status pembayaran nota ${orderId} diubah menjadi: ${newPaymentStatus}`);
        }, 100);
    }
}


// ===============================================================
// LOGIKA DATABASE MULTI-CABANG (OTOMATIS DARI MASTER DB)
// ===============================================================
function loadSettingsUI() {
    const grid = document.getElementById('branch-grid');
    if (!grid) return;

    if (!isMasterLoaded) {
        grid.innerHTML = `<div class="col-span-2 text-center text-xs text-slate-400 py-4">Memuat sinkronisasi database cabang...</div>`;
        syncMasterData().then(() => {
            renderBranchList();
            if (typeof loadReceiptSettings === "function") loadReceiptSettings();
        });
    } else {
        renderBranchList();
        if (typeof loadReceiptSettings === "function") loadReceiptSettings();
    }
}

function renderBranchList() {
    const grid = document.getElementById('branch-grid');
    if (!grid) return;

    if (masterBranches.length === 0) {
        grid.innerHTML = `<div class="col-span-2 text-center text-xs text-slate-400 py-4 italic border border-dashed rounded-xl">Belum ada cabang terdaftar di Master DB.</div>`;
        return;
    }

    grid.innerHTML = masterBranches.map(branch => {
        const isActive = localStorage.getItem('tenant_name') === branch.name;
        const bgStyle = isActive ? 'bg-cyan-50 border-[#40E0D0]' : 'bg-slate-50 border-slate-200';
        const textStatus = isActive ? 'SEDANG AKTIF' : 'PILIH CABANG';

        return `
            <div onclick="switchBranch('${branch.id}')" class="p-4 rounded-2xl border cursor-pointer text-center transition-all active:scale-95 ${bgStyle}">
                <div class="w-8 h-8 ${isActive ? 'theme-bg text-white' : 'bg-white text-slate-400'} mx-auto rounded-full flex items-center justify-center mb-2 shadow-sm">
                    <i class="fa-solid fa-store"></i>
                </div>
                <h4 class="font-bold text-slate-800 text-xs mb-1">${branch.name}</h4>
                <span class="text-[9px] font-bold ${isActive ? 'text-[#40E0D0]' : 'text-slate-400'}">${textStatus}</span>
            </div>
        `;
    }).join('');
}

let targetBranchForAuth = null;

function switchBranch(branchId) {
    const targetBranch = masterBranches.find(b => b.id === branchId);
    if (!targetBranch) return;

    if (localStorage.getItem('tenant_name') === targetBranch.name) {
        return alert(`Database ${targetBranch.name} sudah aktif digunakan saat ini.`);
    }

    // MUNCULKAN MODAL PIN (Bukan lagi pakai confirm)
    targetBranchForAuth = targetBranch;
    document.getElementById('auth-branch-name').innerText = targetBranch.name;
    document.getElementById('auth-branch-pin').value = '';
    document.getElementById('branchAuthModal').classList.remove('hidden');

    // Auto-focus ke input PIN
    setTimeout(() => document.getElementById('auth-branch-pin').focus(), 100);
}

// ===============================================================
// FUNGSI BARU: LOGIKA MODAL PIN CABANG
// ===============================================================
function closeBranchAuthModal() {
    document.getElementById('branchAuthModal').classList.add('hidden');
    targetBranchForAuth = null;
}

function verifyBranchPin() {
    if (!targetBranchForAuth) return;

    const inputPin = document.getElementById('auth-branch-pin').value;
    if (!inputPin) return alert("PIN cabang tidak boleh kosong!");

    if (String(targetBranchForAuth.pin) === String(inputPin)) {

        // 1. Simpan URL dan Nama Cabang
        localStorage.setItem('tenant_script_url', targetBranchForAuth.url);
        localStorage.setItem('tenant_name', targetBranchForAuth.name);
        SCRIPT_URL = targetBranchForAuth.url;
        tenantName = targetBranchForAuth.name;

        // 2. SIMPAN DATA WA & ALAMAT DARI SERVER KE MEMORI LOKAL
        const branchPhone = targetBranchForAuth.phone || "";
        const branchAddress = targetBranchForAuth.address || "";

        if (branchPhone !== "") {
            localStorage.setItem('tenant_phone', branchPhone);
            localStorage.setItem('receipt_phone', branchPhone);
            tenantPhone = branchPhone;
        } else {
            localStorage.removeItem('receipt_phone');
        }

        if (branchAddress !== "") {
            localStorage.setItem('receipt_address', branchAddress);
        } else {
            localStorage.removeItem('receipt_address');
        }

        // 3. PAKSA KOTAK INPUT TERISI SAAT ITU JUGA!
        if (typeof loadReceiptSettings === "function") {
            loadReceiptSettings();
        }

        closeBranchAuthModal();
        updateTenantUI();
        loadSettingsUI();

        services = []; customers = []; orders = []; expenses = []; cart = [];
        renderCart(); resetCashCalculationInputs();

        triggerNotification(`Sukses memuat database ${tenantName}`);
        loadDataFromCloud();

        if (typeof switchView === "function") switchView('pos');

    } else {
        alert("PIN Cabang Salah! Silakan coba lagi.");
        document.getElementById('auth-branch-pin').value = '';
    }
}

function updateTenantUI() {
    const tenantDisplays = document.querySelectorAll('.tenant-name-display');
    tenantDisplays.forEach(el => { el.innerText = tenantName; });

    const notaPhone = document.getElementById('nota-tenant-phone');
    if (notaPhone) { notaPhone.innerText = `Hub: +${tenantPhone}`; }
}

// ===============================================================
// FITUR KEUANGAN TERPADU & PENGELUARAN 
// ===============================================================
function toggleFinanceFilterInputs() {
    const mode = document.getElementById('finance-filter-mode') ? document.getElementById('finance-filter-mode').value : 'today';
    const wrapDate = document.getElementById('wrapper-filter-date');
    const wrapMonth = document.getElementById('wrapper-filter-month');
    const wrapRange = document.getElementById('wrapper-filter-range');

    if (wrapDate) wrapDate.classList.add('hidden');
    if (wrapMonth) wrapMonth.classList.add('hidden');
    if (wrapRange) wrapRange.classList.add('hidden');

    const now = new Date();
    const jktTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));

    // PERBAIKAN BUG TANGGAL: Ambil waktu lokal, BUKAN UTC toISOString
    const y = jktTime.getFullYear();
    const m = String(jktTime.getMonth() + 1).padStart(2, '0');
    const d = String(jktTime.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    if (mode === 'date') {
        if (wrapDate) wrapDate.classList.remove('hidden');
        if (document.getElementById('finance-input-date') && !document.getElementById('finance-input-date').value) {
            document.getElementById('finance-input-date').value = todayStr;
        }
    } else if (mode === 'month') {
        if (wrapMonth) wrapMonth.classList.remove('hidden');
        if (document.getElementById('finance-input-month') && !document.getElementById('finance-input-month').value) {
            document.getElementById('finance-input-month').value = `${y}-${m}`;
        }
    } else if (mode === 'range') {
        if (wrapRange) wrapRange.classList.remove('hidden');
        if (document.getElementById('finance-input-start') && !document.getElementById('finance-input-start').value) {
            document.getElementById('finance-input-start').value = todayStr;
        }
        if (document.getElementById('finance-input-end') && !document.getElementById('finance-input-end').value) {
            document.getElementById('finance-input-end').value = todayStr;
        }
    }
    if (typeof calculateFinance === "function") calculateFinance();
}

// ==========================================
// FUNGSI KALKULASI KEUANGAN (UPGRADED ALUR PIUTANG)
// ==========================================
function calculateFinance() {
    const mode = document.getElementById('finance-filter-mode') ? document.getElementById('finance-filter-mode').value : 'today';

    let filteredOrders = [...orders];
    let filteredExpenses = [...expenses];

    const now = new Date();
    const jktTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));

    const y = jktTime.getFullYear();
    const m = String(jktTime.getMonth() + 1).padStart(2, '0');
    const d = String(jktTime.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    const parseDateString = (dateStr) => {
        if (!dateStr) return null;
        try {
            const dt = new Date(dateStr);
            if (isNaN(dt.getTime())) return null;
            const yr = dt.getFullYear();
            const mo = String(dt.getMonth() + 1).padStart(2, '0');
            const dy = String(dt.getDate()).padStart(2, '0');
            return { dateStr: `${yr}-${mo}-${dy}`, monthStr: `${yr}-${mo}` };
        } catch (e) { return null; }
    };

    const parseNominal = (val) => {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        return Number(val.toString().replace(/[^0-9.-]+/g, "")) || 0;
    };

    // 1. FILTER TANGGAL
    if (mode === 'today') {
        filteredOrders = orders.filter(o => { const p = parseDateString(o.date); return p && p.dateStr === todayStr; });
        filteredExpenses = expenses.filter(e => { const p = parseDateString(e.tanggal || e.date); return p && p.dateStr === todayStr; });
    } else if (mode === 'date') {
        const pickerDate = document.getElementById('finance-input-date').value;
        if (pickerDate) {
            filteredOrders = orders.filter(o => { const p = parseDateString(o.date); return p && p.dateStr === pickerDate; });
            filteredExpenses = expenses.filter(e => { const p = parseDateString(e.tanggal || e.date); return p && p.dateStr === pickerDate; });
        }
    } else if (mode === 'month') {
        const pickerMonth = document.getElementById('finance-input-month').value;
        if (pickerMonth) {
            filteredOrders = orders.filter(o => { const p = parseDateString(o.date); return p && p.monthStr === pickerMonth; });
            filteredExpenses = expenses.filter(e => { const p = parseDateString(e.tanggal || e.date); return p && p.monthStr === pickerMonth; });
        }
    } else if (mode === 'range') {
        const startDate = document.getElementById('finance-input-start').value;
        const endDate = document.getElementById('finance-input-end').value;
        if (startDate && endDate) {
            const startObj = new Date(startDate); startObj.setHours(0, 0, 0, 0);
            const endObj = new Date(endDate); endObj.setHours(23, 59, 59, 999);
            filteredOrders = orders.filter(o => { if (!o.date) return false; const dObj = new Date(o.date); return dObj >= startObj && dObj <= endObj; });
            filteredExpenses = expenses.filter(e => { const tgl = e.tanggal || e.date; if (!tgl) return false; const dObj = new Date(tgl); return dObj >= startObj && dObj <= endObj; });
        }
    }

    // 2. PISAHKAN NOTA LUNAS DAN PIUTANG
    const lunasOrders = filteredOrders.filter(o => o.paymentStatus !== 'Belum Bayar');
    const piutangOrders = filteredOrders.filter(o => o.paymentStatus === 'Belum Bayar');

    // 3. HITUNG METODE PEMBAYARAN (HANYA DARI YANG SUDAH LUNAS)
    const tTunai = lunasOrders.filter(o => o.method === 'Tunai / Cash').reduce((sum, o) => sum + parseNominal(o.total), 0);
    const tQris = lunasOrders.filter(o => o.method === 'QRIS').reduce((sum, o) => sum + parseNominal(o.total), 0);
    const tTransfer = lunasOrders.filter(o => o.method === 'Transfer Bank').reduce((sum, o) => sum + parseNominal(o.total), 0);

    if (document.getElementById('rep-tunai')) document.getElementById('rep-tunai').innerText = `Rp ${tTunai.toLocaleString('id-ID')}`;
    if (document.getElementById('rep-qris')) document.getElementById('rep-qris').innerText = `Rp ${tQris.toLocaleString('id-ID')}`;
    if (document.getElementById('rep-transfer')) document.getElementById('rep-transfer').innerText = `Rp ${tTransfer.toLocaleString('id-ID')}`;

    // 4. HITUNG TOTAL KESELURUHAN
    const tIncome = filteredOrders.reduce((sum, o) => sum + parseNominal(o.total), 0); // Omset Kotor
    const tLunas = lunasOrders.reduce((sum, o) => sum + parseNominal(o.total), 0); // Uang Lunas
    const tBelumLunas = piutangOrders.reduce((sum, o) => sum + parseNominal(o.total), 0); // Uang Nyangkut
    const tExpense = filteredExpenses.reduce((sum, e) => sum + parseNominal(e.nominal || e.amount), 0);

    const netProfit = tLunas - tExpense; // Laba Bersih = Uang Lunas - Pengeluaran

    if (document.getElementById('rep-total-income')) document.getElementById('rep-total-income').innerText = `Rp ${tIncome.toLocaleString('id-ID')}`;
    if (document.getElementById('rep-lunas')) document.getElementById('rep-lunas').innerText = `Rp ${tLunas.toLocaleString('id-ID')}`;
    if (document.getElementById('rep-belum-lunas')) document.getElementById('rep-belum-lunas').innerText = `Rp ${tBelumLunas.toLocaleString('id-ID')}`;
    if (document.getElementById('rep-orders-count')) document.getElementById('rep-orders-count').innerText = `${filteredOrders.length} Transaksi`;
    if (document.getElementById('rep-total-expense')) document.getElementById('rep-total-expense').innerText = `Rp ${tExpense.toLocaleString('id-ID')}`;
    if (document.getElementById('rep-expense-count')) document.getElementById('rep-expense-count').innerText = `${filteredExpenses.length} Catatan`;

    const profitEl = document.getElementById('rep-net-profit');
    if (profitEl) {
        profitEl.innerText = `Rp ${netProfit.toLocaleString('id-ID')}`;
        profitEl.className = netProfit < 0 ? "text-2xl font-extrabold tracking-tight text-rose-200" : "text-2xl font-extrabold tracking-tight text-white";
    }

    if (typeof renderFinanceLogs === "function") { renderFinanceLogs(filteredOrders, filteredExpenses); }
}

function renderFinanceLogs(oData, eData) {
    const listInc = document.getElementById('log-container-income');
    const listExp = document.getElementById('log-container-expense');
    const listPiu = document.getElementById('log-container-piutang');

    const sortedOrders = [...oData].sort((a, b) => new Date(b.date) - new Date(a.date));
    const sortedExpense = [...eData].sort((a, b) => new Date(b.tanggal || b.date) - new Date(a.tanggal || a.date));

    // BATASI RENDER DOM HANYA 50 TERBARU
    const lunasOrders = sortedOrders.filter(o => o.paymentStatus !== 'Belum Bayar').slice(0, 50);
    const piutangOrders = sortedOrders.filter(o => o.paymentStatus === 'Belum Bayar').slice(0, 50);
    const displayExpense = sortedExpense.slice(0, 50);

    // TAMPILAN TAB MASUK (LUNAS)
    if (listInc) {
        listInc.innerHTML = lunasOrders.length === 0 ? `<p class="text-center text-xs text-slate-400 py-3">Tidak ada catatan pemasukan.</p>` : lunasOrders.map(o => `
            <div class="flex justify-between items-center p-2.5 bg-slate-50 rounded-xl mb-2 border border-slate-100">
                <div>
                    <p class="font-bold text-slate-700 text-xs">${o.customer}</p>
                    <p class="text-[10px] text-slate-400">${o.service}</p>
                    <p class="text-[10px] text-slate-400 mt-0.5"><i class="fa-regular fa-calendar-days text-[9px] mr-0.5"></i> ${formatTanggalIndo(o.date)}</p>
                    <span class="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded text-[9px] font-bold">
                        <i class="fa-solid fa-check-circle text-[8px]"></i> Lunas (${o.method})
                    </span>
                </div>
                <div class="text-right">
                    <p class="font-bold text-emerald-600 text-xs">+Rp ${Number(o.total || 0).toLocaleString('id-ID')}</p>
                </div>
            </div>`).join('');
    }

    // TAMPILAN TAB PIUTANG (KUNING/AMBER)
    if (listPiu) {
        listPiu.innerHTML = piutangOrders.length === 0 ? `<p class="text-center text-xs text-slate-400 py-3">Bersih! Tidak ada kasbon/piutang.</p>` : piutangOrders.map(o => `
            <div class="flex justify-between items-center p-2.5 bg-amber-50/50 rounded-xl mb-2 border border-amber-100">
                <div>
                    <p class="font-bold text-slate-800 text-xs">${o.customer}</p>
                    <p class="text-[10px] text-slate-500">${o.service}</p>
                    <p class="text-[10px] text-slate-500 mt-0.5"><i class="fa-regular fa-calendar-days text-[9px] mr-0.5"></i> ${formatTanggalIndo(o.date)}</p>
                    <span class="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 bg-rose-50 text-rose-500 border border-rose-100 rounded text-[9px] font-bold">
                        <i class="fa-solid fa-clock-rotate-left text-[8px]"></i> Belum Bayar
                    </span>
                </div>
                <div class="text-right">
                    <p class="font-bold text-amber-600 text-xs">Rp ${Number(o.total || 0).toLocaleString('id-ID')}</p>
                    
                    <button onclick="handleLunasiLoading('${o.id}')" class="text-[9px] font-bold text-amber-700 bg-amber-100 px-2 py-1 rounded-lg mt-1 hover:bg-amber-200 transition-all">
                        Lunasi <i class="fa-solid fa-arrow-right ml-0.5"></i>
                    </button>

                </div>
            </div>`).join('');
    }

    // TAMPILAN TAB KELUAR (PENGELUARAN)
    if (listExp) {
        listExp.innerHTML = sortedExpense.length === 0 ? `<p class="text-center text-xs text-slate-400 py-3">Tidak ada catatan pengeluaran.</p>` : sortedExpense.map(e => `
            <div class="flex justify-between items-center p-2.5 bg-slate-50 rounded-xl mb-2 border border-slate-100">
                <div>
                    <p class="font-bold text-slate-700 text-xs">${e.keterangan || '-'}</p>
                    <p class="text-[10px] text-slate-400 mt-0.5 mb-1"><i class="fa-regular fa-calendar-days text-[9px] mr-0.5"></i> ${formatTanggalIndo(e.tanggal || e.date)}</p>
                    <span class="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 bg-rose-50 text-rose-500 border border-rose-100 rounded text-[9px] font-bold">
                        <i class="fa-solid fa-wallet text-[8px]"></i> ${e.sumber_dana || 'Kas Laci (Tunai)'}
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <p class="font-bold text-rose-500 text-xs">-Rp ${Number(e.nominal || 0).toLocaleString('id-ID')}</p>
                    <button onclick="deleteExpense('${e.id}')" class="text-rose-400 hover:text-rose-600 bg-white border border-rose-100 shadow-sm px-2 py-1 rounded-lg"><i class="fa-solid fa-trash text-[10px]"></i></button>
                </div>
            </div>`).join('');
    }
}

function switchLogTab(tabId) {
    const listIncome = document.getElementById('log-container-income');
    const listExpense = document.getElementById('log-container-expense');
    const listPiutang = document.getElementById('log-container-piutang');

    const btnIncome = document.getElementById('tab-btn-income');
    const btnExpense = document.getElementById('tab-btn-expense');
    const btnPiutang = document.getElementById('tab-btn-piutang');

    // Reset semua tampilan
    if (listIncome) listIncome.classList.add('hidden');
    if (listExpense) listExpense.classList.add('hidden');
    if (listPiutang) listPiutang.classList.add('hidden');

    const inactiveClass = "flex-1 py-2 text-xs font-bold rounded-lg transition-all text-slate-400 hover:text-slate-600 bg-transparent";
    const activeClass = "flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-white shadow-sm text-slate-800";

    if (btnIncome) btnIncome.className = inactiveClass;
    if (btnExpense) btnExpense.className = inactiveClass;
    if (btnPiutang) btnPiutang.className = inactiveClass;

    // Aktifkan yang dipilih
    if (tabId === 'income') {
        if (listIncome) listIncome.classList.remove('hidden');
        if (btnIncome) btnIncome.className = activeClass;
    } else if (tabId === 'expense') {
        if (listExpense) listExpense.classList.remove('hidden');
        if (btnExpense) btnExpense.className = activeClass;
    } else if (tabId === 'piutang') {
        if (listPiutang) listPiutang.classList.remove('hidden');
        if (btnPiutang) btnPiutang.className = activeClass;
    }
}


function toggleExpenseForm() {
    const form = document.getElementById('inline-expense-form');
    if (form.classList.contains('hidden')) {
        form.classList.remove('hidden');
        document.getElementById('expense-name').value = ''; document.getElementById('expense-amount').value = '';
        document.getElementById('expense-name').focus();
    } else { form.classList.add('hidden'); }
}

function saveNewExpense() {
    const name = document.getElementById('expense-name').value.trim();
    const amount = parseFloat(document.getElementById('expense-amount').value);
    const source = document.getElementById('expense-source') ? document.getElementById('expense-source').value : "Kas Laci (Tunai)";

    if (!name || isNaN(amount)) return alert('❌ Keterangan dan nominal pengeluaran wajib diisi!');

    const payload = {
        id: `EXP-${Math.floor(1000 + Math.random() * 9000)}`,
        tanggal: new Date().toISOString(),
        keterangan: name,
        nominal: amount,
        sumber_dana: source
    };

    expenses.unshift(payload);
    if (typeof calculateFinance === "function") calculateFinance();

    document.getElementById('inline-expense-form').classList.add('hidden');

    // FIX TAMPILAN: Langsung pindah ke tab pengeluaran agar data yang baru diinput terlihat
    if (typeof switchLogTab === "function") switchLogTab('expense');

    if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
        fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: "addExpense", ...payload })
        }).catch(e => console.log("Gagal sinkron ke database:", e));
    }

    triggerNotification(`✅ Pengeluaran "${name}" sukses dicatat!`);
}

function deleteExpense(expId) {
    if (!confirm("Hapus catatan pengeluaran ini secara permanen dari sistem?")) return;
    expenses = expenses.filter(e => e.id !== expId);
    if (typeof calculateFinance === "function") calculateFinance();

    if (SCRIPT_URL !== "" && !SCRIPT_URL.includes("SCRIPT_URL")) {
        fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: "deleteExpense", id: expId }) }).catch(e => console.log("Gagal hapus di database:", e));
    }
    triggerNotification("✅ Data pengeluaran berhasil dihapus.");
}

function exportFinanceToExcel() {
    if (orders.length === 0 && expenses.length === 0) return alert('Data masih kosong!');
    const wb = XLSX.utils.book_new();
    if (orders.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orders), "Pemasukan");
    if (expenses.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenses), "Pengeluaran");
    XLSX.writeFile(wb, `Laporan_Keuangan_${tenantName.replace(/\s+/g, '_')}.xlsx`);
}

function setDefaultDates() {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localNow = (new Date(now - tzOffset)).toISOString().slice(0, 16);
    const inputOrder = document.getElementById('cart-order-date');
    if (inputOrder) inputOrder.value = localNow;

    const pickup = new Date(now.getTime() + (2 * 24 * 60 * 60 * 1000));
    const localPickup = (new Date(pickup - tzOffset)).toISOString().slice(0, 16);
    const inputPickup = document.getElementById('cart-pickup-date');
    if (inputPickup) inputPickup.value = localPickup;
}

function formatTanggalIndo(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ==========================================================================
// OTORISASI CABANG DI HALAMAN SETTINGS (KASIR)
// ==========================================================================

function saveCashierSettings() {
    const branchUrl = document.getElementById('setting-select-branch').value;
    const pinInput = document.getElementById('setting-input-pin').value;

    if (!branchUrl) return alert("Silakan pilih lokasi cabang terlebih dahulu!");
    if (!pinInput) return alert("PIN Cabang tidak boleh kosong!");

    // Gunakan 'masterBranches' dari hasil sinkronisasi Database Master
    const selectedBranch = masterBranches.find(b => b.url === branchUrl);

    if (!selectedBranch) return alert("Data cabang tidak ditemukan!");

    // Validasi apakah PIN yang dimasukkan cocok
    if (String(selectedBranch.pin) === String(pinInput)) {

        // 1. Simpan koneksi Cabang
        localStorage.setItem('tenant_script_url', selectedBranch.url);
        localStorage.setItem('tenant_name', selectedBranch.name);
        SCRIPT_URL = selectedBranch.url;
        tenantName = selectedBranch.name;

        // ==============================================================
        // 2. AUTO-FILL PENGATURAN STRUK (WA & ALAMAT) DARI MASTER
        // ==============================================================
        if (selectedBranch.phone) {
            localStorage.setItem('tenant_phone', selectedBranch.phone);
            localStorage.setItem('receipt_phone', selectedBranch.phone);
            tenantPhone = selectedBranch.phone;
        } else {
            localStorage.removeItem('receipt_phone');
        }

        if (selectedBranch.address) {
            localStorage.setItem('receipt_address', selectedBranch.address);
        } else {
            localStorage.removeItem('receipt_address');
        }

        // Panggil fungsi untuk langsung mengisi kotak di halaman
        if (typeof loadReceiptSettings === "function") {
            loadReceiptSettings();
        }
        // ==============================================================

        // Kosongkan form PIN demi keamanan
        document.getElementById('setting-input-pin').value = '';

        if (typeof triggerNotification === "function") {
            triggerNotification(`Perangkat terhubung ke ${selectedBranch.name}`);
        } else {
            alert(`Berhasil terhubung ke ${selectedBranch.name}`);
        }

        // Muat data dari cabang tersebut
        loadDataFromCloud();

        // Otomatis pindah ke Tab Kasir / POS
        if (typeof switchView === "function") {
            switchView('pos');
        } else if (typeof switchTab === "function") {
            switchTab('pos');
        }

    } else {
        alert("PIN Cabang Salah! Hubungi Owner jika Anda lupa PIN.");
        document.getElementById('setting-input-pin').value = '';
    }
}


function handleLunasiLoading(id) {
    // 1. Munculkan layar loading
    document.getElementById('simple-loading').classList.remove('hidden');

    // 2. Tunggu 0.6 detik (agar loadingnya terlihat), lalu pindah ke halaman Nota
    setTimeout(() => {
        switchView('orders');
        searchByQR(id);

        // 3. Sembunyikan layar loading setelah selesai
        document.getElementById('simple-loading').classList.add('hidden');
    }, 600);
}


// ====================================================================
// FITUR SCANNER QR CODE NOTA & SUARA BIP
// ====================================================================
let html5QrcodeScanner = null;

// Fungsi Pintar: Membuat Suara Bip Tanpa File Audio Eksternal!
function playBeep() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        // 1. Ubah jenis gelombang menjadi "square" agar suaranya tajam/elektronik
        osc.type = "square";

        // 2. Naikkan frekuensi ke 2000Hz agar sangat melengking (sebelumnya 900)
        osc.frequency.setValueAtTime(2000, ctx.currentTime);

        // 3. Volume dikecilkan sedikit agar tidak pecah di speaker (0.05)
        gain.gain.setValueAtTime(0.05, ctx.currentTime);

        osc.start(ctx.currentTime);

        // 4. Durasi dipersingkat menjadi 0.1 detik agar terdengar lebih "cekatan"
        osc.stop(ctx.currentTime + 0.1);
    } catch (e) { console.log("Audio not supported"); }
}

function openQRScanner() {
    // Munculkan layar pop-up kamera
    document.getElementById('qrScannerModal').classList.remove('hidden');

    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode("qr-reader");
    }

    // Nyalakan kamera belakang
    html5QrcodeScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            // JIKA BERHASIL TERSCAN:
            playBeep(); // 1. Bunyikan Bip!

            // 2. Ekstrak otomatis URL (https://foresa.my.id?order=FRS-2361) menjadi "FRS-2361"
            let orderId = decodedText;
            if (decodedText.includes('order=')) {
                orderId = decodedText.split('order=')[1].split('&')[0];
            }

            // 3. Matikan kamera
            closeQRScanner();

            // 4. Masukkan ke input text dan cari otomatis!
            const searchInput = document.querySelector('#view-orders input[type="text"]');
            if (searchInput) {
                searchInput.value = orderId;
            }
            searchByQR(orderId);

            if (typeof triggerNotification === "function") {
                triggerNotification(`✅ Nota Ditemukan: ${orderId}`);
            }
        },
        (errorMessage) => {
            // Abaikan peringatan saat kamera sedang mencari fokus
        }
    ).catch(err => {
        alert("Gagal membuka kamera. Pastikan browser diizinkan mengakses kamera perangkat Anda.");
        closeQRScanner();
    });
}

function closeQRScanner() {
    document.getElementById('qrScannerModal').classList.add('hidden');
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().catch(err => console.log("Gagal mematikan kamera", err));
    }
}


// ====================================================================
// FITUR REFRESH / RESET LIST NOTA
// ====================================================================
function refreshOrderList() {
    const searchInput = document.querySelector('#view-orders input[type="text"]');
    if (searchInput) searchInput.value = '';

    const dateInput = document.getElementById('filter-order-date');
    if (dateInput) dateInput.value = ''; // Reset tanggal

    // 2. Tampilkan efek loading (Skeleton) agar terlihat seperti memuat ulang data
    const ordersList = document.getElementById('orders-list');
    if (ordersList) {
        ordersList.innerHTML = `
            <div class="bg-slate-200 rounded-2xl h-36 w-full animate-pulse"></div>
            <div class="bg-slate-200 rounded-2xl h-36 w-full animate-pulse"></div>
            <div class="bg-slate-200 rounded-2xl h-36 w-full animate-pulse hidden sm:block"></div>`;
    }

    // 3. Tunda 0.4 detik (agar animasi loading terlihat), lalu panggil fungsi render ulang
    setTimeout(() => {
        renderOrders();

        // Panggil notifikasi hijau di atas layar
        if (typeof triggerNotification === "function") {
            triggerNotification('Tampilan daftar nota telah dikembalikan ke semula.');
        }
    }, 400);
}


// ==========================================================
// CETAK PRINT CLOSING KASIR (REKAP HARIAN KOMPLIT)
// ==========================================================
async function printBluetoothClosing() {
    if (orders.length === 0 && expenses.length === 0) {
        return alert('❌ Belum ada data transaksi untuk dicetak!');
    }

    try {
        // 1. KONEKSI KE PRINTER BLUETOOTH
        if (!globalPrinterDevice || !globalPrinterDevice.gatt.connected) {
            triggerNotification("Meminta izin akses Printer Bluetooth...");
            globalPrinterDevice = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'MTP' }, { namePrefix: 'RPP' }, { namePrefix: 'POS' }, { namePrefix: 'EPPOS' }, { services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
                optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
            });
            globalPrinterServer = await globalPrinterDevice.gatt.connect();
            globalPrinterDevice.addEventListener('gattserverdisconnected', () => {
                globalPrinterDevice = null; globalPrinterServer = null;
            });
        }
        if (!globalPrinterDevice || !globalPrinterDevice.gatt.connected) return;

        const service = await globalPrinterServer.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
        const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');

        // 2. KALKULASI DATA (Menyesuaikan dengan filter tanggal yang sedang aktif di layar)
        const mode = document.getElementById('finance-filter-mode') ? document.getElementById('finance-filter-mode').value : 'today';
        const now = new Date();
        const jktTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
        const y = jktTime.getFullYear(); const m = String(jktTime.getMonth() + 1).padStart(2, '0'); const d = String(jktTime.getDate()).padStart(2, '0');
        const todayStr = `${y}-${m}-${d}`;

        const parseDateString = (dateStr) => {
            if (!dateStr) return null;
            try {
                const dt = new Date(dateStr); if (isNaN(dt.getTime())) return null;
                return { dateStr: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` };
            } catch (e) { return null; }
        };

        const parseNominal = (val) => { return Number(val.toString().replace(/[^0-9.-]+/g, "")) || 0; };

        let filteredOrders = [...orders]; let filteredExpenses = [...expenses]; let reportLabel = "HARI INI";

        // Terapkan Filter Tanggal
        if (mode === 'today') {
            filteredOrders = orders.filter(o => { const p = parseDateString(o.date); return p && p.dateStr === todayStr; });
            filteredExpenses = expenses.filter(e => { const p = parseDateString(e.tanggal || e.date); return p && p.dateStr === todayStr; });
            reportLabel = formatTanggalIndo(new Date().toISOString()).split(' ')[0];
        } else if (mode === 'date') {
            const pickerDate = document.getElementById('finance-input-date').value;
            filteredOrders = orders.filter(o => { const p = parseDateString(o.date); return p && p.dateStr === pickerDate; });
            filteredExpenses = expenses.filter(e => { const p = parseDateString(e.tanggal || e.date); return p && p.dateStr === pickerDate; });
            reportLabel = formatTanggalIndo(new Date(pickerDate).toISOString()).split(' ')[0];
        } else {
            reportLabel = "SEMUA DATA (KESELURUHAN)";
        }

        // Kumpulkan Semua Nama Kasir yang melayani
        const cashierNamesArray = Array.from(new Set(filteredOrders.map(o => o.cashier).filter(c => c && c.trim() !== "")));
        const allCashiers = cashierNamesArray.length > 0 ? cashierNamesArray.join(', ') : currentCashier;

        // Pisahkan Lunas & Belum Bayar
        const lunasOrders = filteredOrders.filter(o => o.paymentStatus !== 'Belum Bayar');
        const piutangOrders = filteredOrders.filter(o => o.paymentStatus === 'Belum Bayar');

        // Hitung Pendapatan
        const tIncome = filteredOrders.reduce((sum, o) => sum + parseNominal(o.total), 0); // Omset
        const tLunas = lunasOrders.reduce((sum, o) => sum + parseNominal(o.total), 0);
        const tPiutang = piutangOrders.reduce((sum, o) => sum + parseNominal(o.total), 0);
        
        const tTunai = lunasOrders.filter(o => o.method === 'Tunai / Cash').reduce((sum, o) => sum + parseNominal(o.total), 0);
        const tQris = lunasOrders.filter(o => o.method === 'QRIS').reduce((sum, o) => sum + parseNominal(o.total), 0);
        const tTransfer = lunasOrders.filter(o => o.method === 'Transfer Bank').reduce((sum, o) => sum + parseNominal(o.total), 0);

        // Hitung Pengeluaran
        const tExpenseAll = filteredExpenses.reduce((sum, e) => sum + parseNominal(e.nominal || e.amount), 0);
        const tExpenseTunai = filteredExpenses.filter(e => e.sumber_dana === 'Kas Laci (Tunai)').reduce((sum, e) => sum + parseNominal(e.nominal || e.amount), 0);
        const tExpenseNonTunai = tExpenseAll - tExpenseTunai;

        // Hitungan Akhir Closing Setoran
        const netProfit = tLunas - tExpenseAll;
        const uangFisikLaci = tTunai - tExpenseTunai; // INI YANG PALING PENTING BUAT KASIR!

        // 3. SUSUN DESAIN STRUK CLOSING
        const encoder = new TextEncoder();
        const text = (str) => encoder.encode(str + "\n");
        const ESC = 0x1B;
        const CMD_INIT = new Uint8Array([ESC, 0x40]);
        const CMD_CENTER = new Uint8Array([ESC, 0x61, 1]);
        const CMD_LEFT = new Uint8Array([ESC, 0x61, 0]);
        const CMD_RIGHT = new Uint8Array([ESC, 0x61, 2]);
        const CMD_BOLD_ON = new Uint8Array([ESC, 0x45, 1]);
        const CMD_BOLD_OFF = new Uint8Array([ESC, 0x45, 0]);
        const CMD_FEED = new Uint8Array([ESC, 0x64, 3]);

        let payload = [];
        payload.push(CMD_INIT, CMD_CENTER, CMD_BOLD_ON);
        payload.push(text(`=== REKAP CLOSING KASIR ===`));
        payload.push(text(`${tenantName.toUpperCase()}`));
        payload.push(CMD_BOLD_OFF, CMD_LEFT);
        payload.push(text(`--------------------------------`));
        payload.push(text(`Tgl Laporan : ${reportLabel}`));
        payload.push(text(`Waktu Cetak : ${formatTanggalIndo(new Date().toISOString())}`));
        payload.push(text(`Kasir Shift : ${allCashiers}`));
        payload.push(text(`--------------------------------`));
        
        payload.push(CMD_BOLD_ON, text(`[ PEMASUKAN TOKO ]`), CMD_BOLD_OFF);
        payload.push(text(`Omset Kotor   : Rp ${tIncome.toLocaleString('id-ID')}`));
        payload.push(text(`Piutang/Bon   : Rp ${tPiutang.toLocaleString('id-ID')}`));
        payload.push(text(`Uang Lunas    : Rp ${tLunas.toLocaleString('id-ID')}`));
        payload.push(text(`--------------------------------`));
        
        payload.push(CMD_BOLD_ON, text(`[ METODE PEMBAYARAN ]`), CMD_BOLD_OFF);
        payload.push(text(`Uang Cash   : Rp ${tTunai.toLocaleString('id-ID')}`));
        payload.push(text(`QRIS          : Rp ${tQris.toLocaleString('id-ID')}`));
        payload.push(text(`Transfer Bank : Rp ${tTransfer.toLocaleString('id-ID')}`));
        payload.push(text(`--------------------------------`));
        
        payload.push(CMD_BOLD_ON, text(`[ PENGELUARAN ]`), CMD_BOLD_OFF);
        payload.push(text(`Total Keluar  : Rp ${tExpenseAll.toLocaleString('id-ID')}`));
        payload.push(text(`- Dr Kas Laci : Rp ${tExpenseTunai.toLocaleString('id-ID')}`));
        payload.push(text(`- Non Tunai   : Rp ${tExpenseNonTunai.toLocaleString('id-ID')}`));
        payload.push(text(`--------------------------------`));
        
        payload.push(CMD_CENTER, CMD_BOLD_ON);
        payload.push(text(`=== RINGKASAN SETORAN ===`));
        payload.push(CMD_LEFT);
        payload.push(text(`Laba Bersih   : Rp ${netProfit.toLocaleString('id-ID')}`));
        
        payload.push(CMD_BOLD_ON);
        payload.push(text(`UANG CASH : Rp ${uangFisikLaci.toLocaleString('id-ID')}`));
        payload.push(CMD_BOLD_OFF);
        
        payload.push(CMD_CENTER);
        payload.push(text(`--------------------------------`));
        payload.push(text(`Hitung & cocokkan uang di laci`));
        payload.push(text(`dengan 'UANG CASH' di atas.`));
        payload.push(text(`Ttd. Penanggung Jawab`));
        payload.push(text(`\n\n`));
        payload.push(text(`(.........................)`));
        payload.push(text(`================================`));
        payload.push(CMD_FEED);

        // 4. KIRIM KE PRINTER
        for (const chunk of payload) { await characteristic.writeValue(chunk); }
        triggerNotification('✅ Struk Closing berhasil dicetak!');

    } catch (error) {
        console.error("Gagal cetak closing:", error);
        alert('❌ Pencetakan batal / gagal. Pastikan Printer menyala.');
    }
}
