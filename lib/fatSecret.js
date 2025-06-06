const axios = require('axios');
const FatSecretToken = require('../schema/fatSecretToken');
const { normalizeString } = require('../utils/string');
const Food = require('../schema/food');
const { getOrSetCache } = require('../utils/cache');

class FatSecretAPI {
    constructor() {
        this.clientId = process.env.FATSECRET_CLIENT_ID;
        this.clientSecret = process.env.FATSECRET_CLIENT_SECRET;
        this.tokenUrl = 'https://oauth.fatsecret.com/connect/token';
        this.apiUrl = 'https://platform.fatsecret.com/rest/server.api';
    }

    async getValidToken() {
        return getOrSetCache('fatsecret_token', async () => {
            // Check for existing valid token in database
            const token = await FatSecretToken.findOne({
                expiresAt: { $gt: new Date() }
            }).sort({ createdAt: -1 });

            if (token) {
                return token.accessToken;
            }

            // Get new token if none exists or expired
            return this.refreshToken();
        });
    }

    async refreshToken() {
        try {
            const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

            const response = await axios.post(this.tokenUrl,
                'grant_type=client_credentials&scope=basic',
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': `Basic ${auth}`
                    }
                }
            );

            const { access_token, expires_in } = response.data;

            // Calculate expiration date
            const expiresAt = new Date(Date.now() + (expires_in * 1000));

            // Save token to database
            await FatSecretToken.create({
                accessToken: access_token,
                expiresAt
            });

            return access_token;
        } catch (error) {
            console.error('Error getting FatSecret token:', error);
            throw error;
        }
    }

    async searchFoods(query, pageNumber = 0) {
        try {
            const cacheKey = `food_search_${normalizeString(query)}_${pageNumber}`;
            return getOrSetCache(cacheKey, async () => {
                // First, search in local database
                const normalizedQuery = normalizeString(query);
                const localResults = await Food.find({
                    $or: [
                        { foodName: { $regex: normalizedQuery, $options: 'i' } },
                        { brandName: { $regex: normalizedQuery, $options: 'i' } }
                    ]
                }).limit(20);

                if (localResults.length > 0) {
                    console.log('Local results found', localResults);
                    return {
                        foods: {
                            food: localResults,
                            max_results: "20",
                            page_number: "0",
                            total_results: String(localResults.length)
                        }
                    };
                }

                // If no local results, query FatSecret API
                const token = await this.getValidToken();
                const response = await axios.post(this.apiUrl,
                    null,
                    {
                        params: {
                            method: 'foods.search',
                            search_expression: normalizedQuery,
                            page_number: pageNumber,
                            format: 'json'
                        },
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    }
                );

                // Store results in local database
                if (response.data?.foods?.food) {
                    const foodData = response.data.foods.food;
                    const foods = Array.isArray(foodData) ? foodData : [foodData];
                    for (const food of foods) {
                        const nutritionInfo = this.parseNutritionInfo(food.food_description);
                        await Food.findOneAndUpdate(
                            { foodId: food.food_id },
                            {
                                foodId: food.food_id,
                                brandName: food.brand_name,
                                foodName: food.food_name,
                                foodDescription: food.food_description,
                                foodType: food.food_type,
                                foodUrl: food.food_url,
                                ...nutritionInfo,
                                lastUpdated: new Date()
                            },
                            { upsert: true }
                        );
                    }
                }

                console.log(response.data);

                return response.data;
            });
        } catch (error) {
            console.error('Error searching foods:', error);
            throw error;
        }
    }

    parseNutritionInfo(description) {
        const nutritionInfo = {
            calories: 0,
            fat: 0,
            carbs: 0,
            protein: 0
        };

        if (!description) return nutritionInfo;

        const matches = description.match(/Calories:\s*(\d+)kcal.*Fat:\s*([\d.]+)g.*Carbs:\s*([\d.]+)g.*Protein:\s*([\d.]+)g/);

        if (matches) {
            nutritionInfo.calories = parseInt(matches[1]);
            nutritionInfo.fat = parseFloat(matches[2]);
            nutritionInfo.carbs = parseFloat(matches[3]);
            nutritionInfo.protein = parseFloat(matches[4]);
        }

        return nutritionInfo;
    }
}

module.exports = new FatSecretAPI(); 