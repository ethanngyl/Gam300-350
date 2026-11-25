#include "StressTestRunner.h"

#include "splat/SplatExporter.h"
#include "splat/SplatGenerator.h"
#include "splat/SplatLoader.h"
#include "splat/SplatRenderer.h"
#include "splat/SplatTrimmer.h"
#include "ui/EditCommands.h"
#include "ui/Viewport.h"

#include <glm/gtc/matrix_transform.hpp>

#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QLocale>
#include <QTemporaryDir>
#include <QUndoStack>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <functional>
#include <string>

#include <cstdint>

namespace {
	//Runs fn and returns how long it took in milliseconds
	template <typename Fn>
	double MeasureMs(Fn&& fn) {
		QElapsedTimer timer;
		timer.start();
		fn();
		return static_cast<double>(timer.nsecsElapsed()) / 1.0e6;
	}

	//Ascending indices 0, stride, 2 * stride, ... below total
	std::vector<uint32_t> MakeIndices(size_t total, size_t stride) {
		std::vector<uint32_t> indices;
		indices.reserve(total / stride + 1);
		for (size_t i = 0; i < total; i += stride) {
			indices.push_back(static_cast<uint32_t>(i));
		}
		return indices;
	}

	//Hover text for the rows, shared so every test words the two steps the same way
	const QString kApplyTip = "Makes the change in memory (CPU only).";
	const QString kRedrawTip = "Draws one frame so the change shows on screen. Updates the splat data and sends it to the graphics card (CPU + GPU).";
	const QString kUndoTip = "Undoes the edit in memory (CPU only). Nothing is drawn yet.";
	const QString kRedoTip = "Redoes the edit in memory (CPU only). Nothing is drawn yet.";
}

std::vector<StressResult> StressTestRunner::TestLoad(size_t count) {
	//The sphere is generated here and handed over, so it is freed as soon as it is saved
	Report("Load: generating the sphere");
	return LoadThroughDisk(splat_generate::GenerateSphereSplats(count), "StressTestSphere");
}

std::vector<StressResult> StressTestRunner::TestLoadCopy() {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer) {
		return {};
	}
	SplatModel* model = renderer->GetModel(renderer->GetSelectedModel());
	if (!model || model->splats().empty()) {
		return {};
	}

	//A copy of the selected model's splats is saved and loaded back, the model itself and its file are not touched
	const std::string copyName = model->GetName() + " (load test copy)";
	std::vector<StressResult> results = LoadThroughDisk(model->splats(), copyName);
	if (results.empty()) {
		return results;
	}

	//The copy was only there to time the load. Take it back out (it is the last model), so the scene is as it was
	//The selected model keeps its place, removing the last one does not shift any index
	renderer->RemoveModel(static_cast<int>(renderer->ModelCount()) - 1);
	m_viewport->RenderFrameBlocking();
	return results;
}

std::vector<StressResult> StressTestRunner::LoadThroughDisk(std::vector<SplatVertex> source, const std::string& modelName) {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer || renderer->ModelCount() >= static_cast<size_t>(SplatRenderer::kMaxModels) || source.empty()) {
		return {};
	}

	//Setup, not timed: save the splats like a normal model, so the load below reads a real .ply
	//The folder and the file in it are deleted when dir goes out of scope
	Report("Load: saving the test file");
	QTemporaryDir dir;
	if (!dir.isValid()) {
		qWarning("Load test: could not create a temporary folder.");
		return {};
	}
	const QString path = dir.filePath("LoadTest.ply");
	{
		ExportOptions options;
		options.format = ExportFormat::GaussianPly; //The format the importer reads
		const ExportResult saved = ExportSplats({ ExportSource{ &source, glm::mat4(1.0f) } },
			std::filesystem::path(path.toStdWString()), options);
		if (!saved.ok) {
			qWarning("Load test: could not save the test file: %s", saved.error.c_str());
			return {};
		}
	}
	std::vector<SplatVertex>().swap(source); //Freed, so the splats are not held in memory twice while the file is read back

	//Same call an import makes
	Report("Load: reading the file from disk");
	std::vector<SplatVertex> splats;
	const std::string nativePath = QDir::toNativeSeparators(path).toLocal8Bit().toStdString();
	const double readMs = MeasureMs([&] { splats = LoadSplatPly(nativePath); });
	if (splats.empty()) {
		qWarning("Load test: the saved test file could not be read back.");
		return {};
	}
	const size_t loaded = splats.size();

	Report("Load: adding to the scene and redrawing");
	const double setMs = MeasureMs([&] { renderer->SetSplats(splats, modelName); });
	const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });

	return {
		{ "Load: Read from disk", loaded, readMs,
			"Reads the saved .ply file and turns it into splats (disk + CPU). This is the same code an import uses. "
			"The file was just written, so the operating system probably still has it cached may be faster than first read of an old file." },
		{ "Load: Add to scene", loaded, setMs, "Hands the splats to the renderer as a new model (CPU only). Nothing is drawn yet." },
		{ "Load: Redraw", loaded, frameMs, kRedrawTip },
	};
}

std::vector<StressResult> StressTestRunner::TestTrim() {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer) {
		return {};
	}
	const int modelIndex = renderer->GetSelectedModel();
	SplatModel* model = renderer->GetModel(modelIndex);
	const size_t total = renderer->GetSplatCount(modelIndex);
	if (!model || total == 0) {
		return {};
	}

	//Start from a clean, uploaded scene so the first case is not charged for earlier pending work
	//The selection holds splat positions, which trimming changes
	Report("Trim: preparing the test data");
	renderer->ClearSelection();
	m_viewport->RenderFrameBlocking();

	//Every case trims from this copy and the model is put back to it after each case
	const std::vector<SplatVertex> saved = model->splats();

	//The test sphere is fully opaque, so min alpha would cut nothing on it
	//If every splat has the same alpha, the min alpha cases trim a copy with the alpha spread evenly from 0 to 1 instead,
	//so a min alpha of 0.25 cuts about a quarter. The model itself is never changed, only this copy is
	//A model that really has varying alpha is trimmed as it is
	bool flatAlpha = true;
	for (const SplatVertex& splat : saved) {
		if (splat.alpha != saved.front().alpha) {
			flatAlpha = false;
			break;
		}
	}
	std::vector<SplatVertex> spreadAlpha;
	if (flatAlpha) {
		spreadAlpha = saved;
		for (size_t i = 0; i < spreadAlpha.size(); ++i) {
			//Steps of the golden ratio land evenly over 0..1 whatever the splat count
			spreadAlpha[i].alpha = static_cast<float>(std::fmod(static_cast<double>(i) * 0.6180339887498949, 1.0));
		}
	}
	const std::vector<SplatVertex>& alphaSource = flatAlpha ? spreadAlpha : saved;

	//Min alpha values that cut about the lowest 25%, 50% and 90% of the splats, read from the alpha values of the model itself
	//Fixed values would cut very different amounts from different models, this way every model loses about the same share
	//Ties (many splats with the same alpha) can make the real cut a little smaller, the Compute row says how much was kept
	std::vector<float> alphas;
	alphas.reserve(alphaSource.size());
	for (const SplatVertex& splat : alphaSource) {
		if (std::isfinite(splat.alpha)) {
			alphas.push_back(splat.alpha);
		}
	}
	auto alphaForCut = [&alphas](double fraction) {
		if (alphas.empty()) {
			return 0.0f; //0 means min alpha is off
		}
		const size_t index = std::min(alphas.size() - 1, static_cast<size_t>(fraction * static_cast<double>(alphas.size())));
		std::nth_element(alphas.begin(), alphas.begin() + static_cast<std::ptrdiff_t>(index), alphas.end());
		return alphas[index];
	};
	const float alphaCut25 = alphaForCut(0.25);
	const float alphaCut50 = alphaForCut(0.50);
	const float alphaCut90 = alphaForCut(0.90);

	//The density filter drops splats in cells holding fewer than this, scaled to the splat count so it cuts at any size
	const int densityMin = std::max(2, static_cast<int>(total / 10000));
	struct Case {
		QString label;
		TrimData settings; //minAlpha, cropPct, voxelDivisions, minPerVoxel
		bool byAlpha;      //Trim the copy with spread out alpha (if the model needs one), the others trim the model's own splats
	};
	const Case cases[] = {
		{ "crop 5%", TrimData{ 0.0f, 5.0f, 0, 1 }, false },
		{ "crop 25%", TrimData{ 0.0f, 25.0f, 0, 1 }, false },
		{ "density filter", TrimData{ 0.0f, 0.0f, 50, densityMin }, false },
		{ "crop 25% + density", TrimData{ 0.0f, 25.0f, 50, densityMin }, false },
		{ "min alpha (lowest 25%)", TrimData{ alphaCut25, 0.0f, 0, 1 }, true },
		{ "min alpha (lowest 50%)", TrimData{ alphaCut50, 0.0f, 0, 1 }, true },
		{ "min alpha (lowest 90%)", TrimData{ alphaCut90, 0.0f, 0, 1 }, true },
		{ "default settings", TrimData{}, false },
	};

	const QLocale locale;
	std::vector<StressResult> results;
	for (const Case& c : cases) {
		Report(QString("Trim %1").arg(c.label));
		const std::vector<SplatVertex>& source = c.byAlpha ? alphaSource : saved;
		std::vector<SplatVertex> trimmed;
		const double computeMs = MeasureMs([&] { trimmed = TrimSplats(source, c.settings); });
		const size_t kept = trimmed.size();

		const QString label = QString("Trim %1").arg(c.label);
		QString computeTip = QString("Works out which splats to cut and copies the rest (CPU only). Kept %1 of %2 splats (%3%).")
			.arg(locale.toString(static_cast<qulonglong>(kept)), locale.toString(static_cast<qulonglong>(total)))
			.arg(100.0 * static_cast<double>(kept) / static_cast<double>(total), 0, 'f', 1);
		if (c.byAlpha) {
			computeTip += QString(" Min alpha used: %1.").arg(static_cast<double>(c.settings.minAlpha), 0, 'f', 4);
			if (flatAlpha) {
				computeTip += " Every splat of this model has the same alpha, so a copy with the alpha spread evenly from 0 to 1 was trimmed.";
			}
		}
		results.push_back({ label + ": Compute", total, computeMs, computeTip });

		//The editor refuses a trim that would remove every splat
		if (trimmed.empty()) {
			continue;
		}

		const double applyMs = MeasureMs([&] { renderer->UpdateModel(model, trimmed); });
		const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });
		results.push_back({ label + ": Apply", kept, applyMs,
			"Replaces the model's splats with the trimmed ones in memory (CPU only). Nothing is drawn yet." });
		results.push_back({ label + ": Redraw", kept, frameMs, kRedrawTip });

		//Put all the splats back, so the next case starts the same way
		renderer->UpdateModel(model, saved);
		m_viewport->RenderFrameBlocking();
	}
	return results;
}

std::vector<StressResult> StressTestRunner::TestExport() {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer) {
		return {};
	}
	const int modelIndex = renderer->GetSelectedModel();
	SplatModel* model = renderer->GetModel(modelIndex);
	if (!model || model->splats().empty()) {
		return {};
	}

	//The folder and any file still in it are deleted when dir goes out of scope
	QTemporaryDir dir;
	if (!dir.isValid()) {
		qWarning("Export test: could not create a temporary folder.");
		return {};
	}

	//Every case exports every splat, mesh formats included, so the rows are comparable
	const std::vector<SplatVertex>& all = model->splats();

	struct Case {
		const char* label;
		ExportFormat format;
		ExportGeometry geometry;
	};
	const Case cases[] = {
		{ "Gaussian PLY", ExportFormat::GaussianPly, ExportGeometry::Points },
		{ "Splat file", ExportFormat::SplatFile, ExportGeometry::Points },
		{ "PLY points", ExportFormat::PointCloudPly, ExportGeometry::Points },
		{ "OBJ points", ExportFormat::Obj, ExportGeometry::Points },
		{ "GLB points", ExportFormat::Glb, ExportGeometry::Points },
		{ "GLB mesh", ExportFormat::Glb, ExportGeometry::Mesh },
		{ "STL mesh", ExportFormat::Stl, ExportGeometry::Mesh },
	};

	const QLocale locale;
	std::vector<StressResult> results;
	for (const Case& c : cases) {
		Report(QString("Export %1").arg(c.label));
		ExportOptions options;
		options.format = c.format;
		options.geometry = c.geometry;
		//The model's transform is baked in, like an export from the editor
		const std::vector<ExportSource> sources = { ExportSource{ &all, model->GetTransform() } };
		const QString path = dir.filePath(QString("export") + QString::fromLatin1(ExportFormatExtension(c.format)));

		ExportResult exported;
		const double ms = MeasureMs([&] {
			exported = ExportSplats(sources, std::filesystem::path(path.toStdWString()), options);
		});
		const qint64 bytes = QFileInfo(path).size();
		QFile::remove(path); //Not kept, whether or not the export worked

		const QString name = QString("Export %1").arg(c.label);
		if (!exported.ok) {
			//Still gets a row, so the results always have the same rows and a failure cannot be mistaken for a case that did not run
			const QString reason = QString::fromStdString(exported.error);
			qWarning("Export test: %s failed: %s", c.label, exported.error.c_str());
			results.push_back({ name, all.size(), 0.0,
				QString("Tried to save %1 splats as a %2 file in a temporary folder (%3).")
					.arg(locale.toString(static_cast<qulonglong>(all.size())),
						QString::fromLatin1(ExportFormatName(c.format)), QDir::toNativeSeparators(dir.path())),
				false, reason });
			continue;
		}

		QString tip = QString("Saves %1 splats as a %2 file in a temporary folder (CPU + disk). File size: %3. "
			"The file is deleted straight away. The time ends when the operating system has the file, it is not forced onto the drive.")
			.arg(locale.toString(static_cast<qulonglong>(exported.splatCount)),
				QString::fromLatin1(ExportFormatName(c.format)), locale.formattedDataSize(bytes));
		if (c.geometry == ExportGeometry::Mesh) {
			tip += QString(" Mesh export turns every splat into a small shape. That made %1 vertices and %2 triangles.")
				.arg(locale.toString(static_cast<qulonglong>(exported.vertexCount)),
					locale.toString(static_cast<qulonglong>(exported.triangleCount)));
		}
		results.push_back({ name, exported.splatCount, ms, tip });
	}
	return results;
}

std::vector<StressResult> StressTestRunner::TestSelect() {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer) {
		return {};
	}
	const int modelIndex = renderer->GetSelectedModel();
	const size_t total = renderer->GetSplatCount(modelIndex);
	if (!renderer->GetModel(modelIndex) || total == 0) {
		return {};
	}

	//Start from a clean, uploaded scene so the first case is not charged for earlier pending work
	renderer->ClearSelection();
	m_viewport->RenderFrameBlocking(); //Block renderer

	//Struct of test cases
	struct Case {
		const char* label;
		size_t stride;
	};
	const Case cases[] = { { "All", 1 }, { "Half", 2 }, { "Tenth", 10 } };

	std::vector<StressResult> results;

	//Loop for each test case
	for (const Case& c : cases) {
		Report(QString("Select %1").arg(c.label));
		std::vector<uint32_t> indices;
		const double setMs = MeasureMs([&]
			{
				//Reserve enough space for all selected splats
				indices.reserve(total / c.stride + 1);
				for (size_t i = 0; i < total; i += c.stride)
				{
					//Push back to store selected splats index
					//Ascending order, SetSelection expects it that way
					indices.push_back(static_cast<uint32_t>(i)); 
				}
				//Actually select the splats
				renderer->SetSelection(modelIndex, std::move(indices));
			});
		const size_t selected = renderer->Selection().size();
		const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });

		const QString label = QString("Select %1").arg(c.label);
		results.push_back({ label + ": Apply", selected, setMs, kApplyTip });
		results.push_back({ label + ": Redraw", selected, frameMs, kRedrawTip });

		//Back to nothing selected, so the next case starts the same way
		renderer->ClearSelection();
		m_viewport->RenderFrameBlocking();
	}

	//Deselecting a full selection, the selection itself is set up outside the timing
	Report("Deselect all");
	std::vector<uint32_t> everything(total);
	for (size_t i = 0; i < total; ++i) 
	{
		everything[i] = static_cast<uint32_t>(i);
	}
	renderer->SetSelection(modelIndex, std::move(everything));
	m_viewport->RenderFrameBlocking();

	const double clearMs = MeasureMs([&]
	{
		renderer->ClearSelection();
		m_viewport->RenderFrameBlocking(); //Un-marks the splats and uploads
	});
	results.push_back({ "Deselect all: Apply + Redraw", total, clearMs,
		"Clears the selection in memory, then draws one frame so it shows on screen (CPU + GPU). Timed as one step." });
	return results;
}

std::vector<StressResult> StressTestRunner::TestMove() {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer) {
		return {};
	}
	const int modelIndex = renderer->GetSelectedModel();
	SplatModel* model = renderer->GetModel(modelIndex);
	const size_t total = renderer->GetSplatCount(modelIndex);
	if (!model || total == 0) {
		return {};
	}

	//Start from a clean, uploaded scene so the first case is not charged for earlier pending work
	renderer->ClearSelection();
	m_viewport->RenderFrameBlocking();

	QUndoStack stack; //Private, the editor's own undo history is not touched
	const glm::vec3 offset(0.5f, 0.0f, 0.0f);
	std::vector<StressResult> results;

	//Moving the whole model only changes its transform, the splat data is not touched
	Report("Move model");
	{
		const glm::mat4 before = model->GetTransform();
		const glm::mat4 after = glm::translate(before, offset);
		const double applyMs = MeasureMs([&] { stack.push(new MoveModelCommand(model, before, after)); });
		const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });
		results.push_back({ "Move model: Apply", total, applyMs,
			"Changes the model's position (CPU only). The splats themselves are not rewritten." });
		results.push_back({ "Move model: Redraw", total, frameMs, kRedrawTip });

		stack.undo(); //Put the model back
		m_viewport->RenderFrameBlocking();
	}

	//Moving splats rewrites them in the model, so the whole splat array is rebuilt and uploaded again
	struct Case {
		const char* label;
		size_t stride;
		bool selected; //Select the splats first and move the selection, like the editor does
	};
	const Case cases[] = { { "all splats", 1, false }, { "half of splats", 2, false }, { "selected tenth", 10, true } };
	const glm::mat4 delta = glm::translate(glm::mat4(1.0f), offset);

	for (const Case& c : cases) {
		Report(QString("Move %1").arg(c.label));
		std::vector<uint32_t> indices = MakeIndices(total, c.stride);
		if (c.selected) {
			//Selecting is set up outside the timing, this test measures the move
			renderer->SetSelection(modelIndex, indices);
			m_viewport->RenderFrameBlocking();
			indices = renderer->Selection();
		}
		const size_t moved = indices.size();

		const double applyMs = MeasureMs([&] { stack.push(new MoveSplatsCommand(renderer, model, indices, delta)); });
		const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });

		const QString label = QString("Move %1").arg(c.label);
		results.push_back({ label + ": Apply", moved, applyMs,
			"Builds the undo data (the splats before and after the move) and moves them in memory (CPU only)." });
		results.push_back({ label + ": Redraw", moved, frameMs, kRedrawTip });

		//Put the splats back and clear the selection, so the next case starts the same way
		stack.undo();
		renderer->ClearSelection();
		m_viewport->RenderFrameBlocking();
	}
	return results;
}

std::vector<StressResult> StressTestRunner::TestDelete() {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer) {
		return {};
	}
	const int modelIndex = renderer->GetSelectedModel();
	SplatModel* model = renderer->GetModel(modelIndex);
	const size_t total = renderer->GetSplatCount(modelIndex);
	if (!model || total == 0) {
		return {};
	}

	//Start from a clean, uploaded scene so the first case is not charged for earlier pending work
	renderer->ClearSelection();
	m_viewport->RenderFrameBlocking();

	QUndoStack stack; //Private, the editor's own undo history is not touched
	std::vector<StressResult> results;

	struct Case {
		const char* label;
		size_t stride;
		bool selected; //Select the splats first and delete the selection, like the editor does
	};
	const Case cases[] = { { "half of splats", 2, false }, { "selected tenth", 10, true } };

	for (const Case& c : cases) {
		Report(QString("Delete %1").arg(c.label));
		std::vector<uint32_t> indices = MakeIndices(total, c.stride);
		if (c.selected) {
			//Selecting is set up outside the timing, this test measures the delete
			renderer->SetSelection(modelIndex, indices);
			m_viewport->RenderFrameBlocking();
			indices = renderer->Selection();
		}

		//1 = keep, 0 = delete, the mask is part of the setup
		std::vector<uint8_t> keepMask(total, 1);
		for (uint32_t index : indices) {
			keepMask[index] = 0;
		}
		const size_t deleted = indices.size();

		const double applyMs = MeasureMs([&] { stack.push(new RemoveSplatsCommand(renderer, model, keepMask)); });
		const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });

		const QString label = QString("Delete %1").arg(c.label);
		results.push_back({ label + ": Apply", deleted, applyMs,
			"Remembers the deleted splats for undo and removes them from the model in memory (CPU only)." });
		results.push_back({ label + ": Redraw", deleted, frameMs, kRedrawTip });

		//Bring the splats back and clear the selection, so the next case starts the same way
		stack.undo();
		renderer->ClearSelection();
		m_viewport->RenderFrameBlocking();
	}

	//Deleting a whole model cannot be undone, so delete a copy that only exists for this test
	Report("Delete model");
	if (renderer->ModelCount() < static_cast<size_t>(SplatRenderer::kMaxModels)) {
		renderer->SetSplats(model->splats(), "StressTestCopy");
		m_viewport->RenderFrameBlocking(); //Upload the copy first, so only the delete is timed below
		const int copyIndex = static_cast<int>(renderer->ModelCount()) - 1;

		const double applyMs = MeasureMs([&] { renderer->RemoveModel(copyIndex); });
		const double frameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });
		results.push_back({ "Delete model: Apply", total, applyMs,
			"Removes the whole model from the scene in memory (CPU only)." });
		results.push_back({ "Delete model: Redraw", total, frameMs, kRedrawTip });
	}
	return results;
}

std::vector<StressResult> StressTestRunner::TestUndoRedo() {
	SplatRenderer* renderer = m_viewport->renderer();
	if (!renderer) {
		return {};
	}
	const int modelIndex = renderer->GetSelectedModel();
	SplatModel* model = renderer->GetModel(modelIndex);
	const size_t total = renderer->GetSplatCount(modelIndex);
	if (!model || total == 0) {
		return {};
	}

	//Start from a clean, uploaded scene so the first case is not charged for earlier pending work
	renderer->ClearSelection();
	m_viewport->RenderFrameBlocking();

	const glm::vec3 offset(0.5f, 0.0f, 0.0f);
	const glm::mat4 delta = glm::translate(glm::mat4(1.0f), offset);
	const std::vector<uint32_t> allIndices = MakeIndices(total, 1);
	const std::vector<uint32_t> halfIndices = MakeIndices(total, 2);
	std::vector<uint8_t> keepMask(total, 1); //1 = keep, 0 = delete, every 2nd splat goes
	for (uint32_t index : halfIndices) {
		keepMask[index] = 0;
	}

	struct Case {
		const char* label;
		size_t splatCount; //Splats the edit touches
		std::function<QUndoCommand*()> makeEdit;
	};
	const Case cases[] = {
		{ "move model", total, [&] {
			const glm::mat4 before = model->GetTransform();
			return new MoveModelCommand(model, before, glm::translate(before, offset));
		} },
		{ "move all splats", total, [&] { return new MoveSplatsCommand(renderer, model, allIndices, delta); } },
		{ "delete half of splats", halfIndices.size(), [&] { return new RemoveSplatsCommand(renderer, model, keepMask); } },
	};

	QUndoStack stack; //Private, the editor's own undo history is not touched
	std::vector<StressResult> results;

	for (const Case& c : cases) {
		Report(QString("Undo/redo %1").arg(c.label));
		//Setup, not timed: do the edit once so there is something to undo
		stack.push(c.makeEdit());
		m_viewport->RenderFrameBlocking();

		const double undoApplyMs = MeasureMs([&] { stack.undo(); });
		const double undoFrameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });
		const double redoApplyMs = MeasureMs([&] { stack.redo(); });
		const double redoFrameMs = MeasureMs([&] { m_viewport->RenderFrameBlocking(); });

		const QString label = c.label;
		results.push_back({ "Undo " + label + ": Apply", c.splatCount, undoApplyMs, kUndoTip });
		results.push_back({ "Undo " + label + ": Redraw", c.splatCount, undoFrameMs, kRedrawTip });
		results.push_back({ "Redo " + label + ": Apply", c.splatCount, redoApplyMs, kRedoTip });
		results.push_back({ "Redo " + label + ": Redraw", c.splatCount, redoFrameMs, kRedrawTip });

		//The edit is redone at this point, undo it so the model is back as it was, and start the next case empty
		stack.undo();
		stack.clear();
		renderer->ClearSelection();
		m_viewport->RenderFrameBlocking();
	}
	return results;
}
