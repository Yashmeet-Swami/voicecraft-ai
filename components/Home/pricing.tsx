export default function Pricing() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="grid md:grid-cols-2 gap-8 w-full max-w-4xl">
        
        {/* Basic Plan */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-semibold">Basic</h2>
            <p className="text-gray-500 text-sm mb-4">
              Get started with SpeakEasy!
            </p>
            <p className="text-3xl font-bold">
              $10 <span className="text-base font-medium text-gray-500">USD /month</span>
            </p>

            <ul className="mt-4 space-y-2 text-gray-600 text-sm">
              <li>✔ 3 Blog Posts</li>
              <li>✔ 3 Transcription</li>
            </ul>
          </div>
          <button className="mt-6 w-full bg-black text-white py-2 rounded-full hover:bg-gray-800 transition">
            Get SpeakEasy →
          </button>
        </div>

        {/* Pro Plan */}
        <div className="rounded-2xl border border-purple-300 bg-white shadow-md p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-semibold">Pro</h2>
            <p className="text-gray-500 text-sm mb-4">
              All Blog Posts, let’s go!
            </p>
            <p className="text-3xl font-bold">
              $19.99 <span className="text-base font-medium text-gray-500">USD /month</span>
            </p>

            <ul className="mt-4 space-y-2 text-gray-600 text-sm">
              <li>✔ Unlimited Blog Posts</li>
              <li>✔ Unlimited Transcriptions</li>
            </ul>
          </div>
          <button className="mt-6 w-full bg-black text-white py-2 rounded-full hover:bg-gray-800 transition">
            Get SpeakEasy →
          </button>
        </div>
      </div>
    </div>
  );
}
