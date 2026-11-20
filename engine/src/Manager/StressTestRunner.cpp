#include "StressTestRunner.h"

#include "splat/SplatGenerator.h"
#include "splat/SplatRenderer.h"
#include "ui/Viewport.h"

#include <QElapsedTimer>

namespace {
	//Runs fn and returns how long it took in milliseconds
	template <typename Fn>
	double MeasureMs(Fn&& fn) {
		QElapsedTimer timer;
		timer.start();
		fn();
		return static_cast<double>(timer.nsecsElapsed()) / 1.0e6;
	}
}

std::vector<StressResult> StressTestRunner::TestLoad(size_t count) {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer || renderer->ModelCount() >= static_cast<size_t>(SplatRenderer::kMaxModels)) {
		return {};
	}

	std::vector<SplatVertex> splats;
	const double generateMs = MeasureMs([&] { splats = splat_generate::GenerateSphereSplats(count); });
	const double setMs = MeasureMs([&] { renderer->SetSplats(splats, "StressTestSphere"); });
	const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });

	return {
		{ "Load: generate splats", count, generateMs },
		{ "Load: SetSplats (CPU copy)", count, setMs },
		{ "Load: first frame (upload + draw)", count, frameMs },
		{ "Load: total", count, generateMs + setMs + frameMs },
	};
}
