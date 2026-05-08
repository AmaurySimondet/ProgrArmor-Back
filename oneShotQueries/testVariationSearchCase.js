require('dotenv').config();
const axios = require('axios');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:8800';
const ENDPOINT_PATH = '/user/variation/search';

const params = {
    search: 'déve',
    muscle: 'chest',
    page: 1,
    sortBy: 'recommended',
    limit: 8,
    isExercice: true,
    userId: '6365489f44d4b4000470882b'
};

function buildHeaders() {
    const headers = {};
    const bearer = process.env.TEST_AUTH_TOKEN;
    const cookie = process.env.TEST_COOKIE;

    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (cookie) headers.Cookie = cookie;

    return headers;
}

function conclude(result) {
    if (result.httpStatus === 401 || result.httpStatus === 403) {
        return 'UNAUTHORIZED: impossible de vérifier le contenu métier sans auth valide.';
    }
    if (result.httpStatus >= 400) {
        return `HTTP_ERROR_${result.httpStatus}: la requête échoue avant analyse du résultat.`;
    }
    if (!result.success) {
        return 'API_NOT_SUCCESS: success=false, vérifier validation/erreurs backend.';
    }
    if (result.total === 0 || result.count === 0) {
        return 'EMPTY: la requête ne retourne aucune variation pour ce cas précis.';
    }
    return `NON_EMPTY: ${result.count} variation(s) retournée(s), total=${result.total}.`;
}

async function run() {
    const url = `${BASE_URL}${ENDPOINT_PATH}`;
    const headers = buildHeaders();

    console.log('--- Test case /user/variation/search ---');
    console.log('URL:', url);
    console.log('Params:', params);
    console.log('Auth header:', headers.Authorization ? 'Bearer token fourni' : 'absent');
    console.log('Cookie header:', headers.Cookie ? 'fourni' : 'absent');

    try {
        const response = await axios.get(url, {
            params,
            headers,
            validateStatus: () => true,
            timeout: 10000
        });

        const payload = response.data;
        const result = {
            httpStatus: response.status,
            success: Boolean(payload?.success),
            total: Number(payload?.pagination?.total || 0),
            count: Array.isArray(payload?.variations) ? payload.variations.length : 0
        };

        console.log('\nHTTP status:', result.httpStatus);
        console.log('success:', result.success);
        console.log('pagination.total:', result.total);
        console.log('variations.length:', result.count);
        console.log('message:', payload?.message || '(none)');

        if (Array.isArray(payload?.variations) && payload.variations.length > 0) {
            const preview = payload.variations.slice(0, 3).map(v => ({
                _id: v?._id,
                name: v?.name?.fr || v?.name?.en || '(sans nom)'
            }));
            console.log('preview:', preview);
        }

        console.log('\nConclusion:', conclude(result));
    } catch (error) {
        console.error('Request failed:', error.message);
        process.exitCode = 1;
    }
}

run();
